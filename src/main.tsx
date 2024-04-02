import { Devvit, svg } from "@devvit/public-api";

const VOTING_PERIOD_DURATION = 5 * 60 * 1000;
//const VOTING_PERIOD_DURATION = 20 * 1000;
const UPDATE_RATE = 1000;
const N = 16;

const colors = [
  "#FFFFFF",
  "#E4E4E4",
  "#888888",
  "#222222",
  "#FFA7D1",
  "#E50000",
  "#E59500",
  "#A06A42",
  "#E5D900",
  "#94E044",
  "#02BE01",
  "#00D3DD",
  "#0083C7",
  "#0000EA",
  "#CF6EE4",
  "#820080",
];

type VoteDetail = {
  count: number;
  userIds: string[];
};

type PixelVotes = {
  [color: string]: VoteDetail;
};

type Votes = {
  [pixelKey: string]: PixelVotes;
};

function adjustCanvasSize(canvas: string[][], targetSize: number): string[][] {
  const currentSize = canvas.length;
  const adjustedCanvas = [];

  for (let i = 0; i < targetSize; i++) {
    if (i < currentSize) {
      // If the current row exists, adjust its length
      const currentRow = canvas[i];
      adjustedCanvas[i] = currentRow.slice(0, targetSize);

      // If the row is shorter than the target size, fill the rest with white
      while (adjustedCanvas[i].length < targetSize) {
        adjustedCanvas[i].push("#FFFFFF");
      }
    } else {
      // If the current row does not exist, fill the new row with white
      adjustedCanvas.push(Array(targetSize).fill("#FFFFFF"));
    }
  }

  return adjustedCanvas;
}

function isDark(color: string) {
  const hex = color.replace("#", "");
  const c_r = parseInt(hex.substr(0, 2), 16);
  const c_g = parseInt(hex.substr(2, 2), 16);
  const c_b = parseInt(hex.substr(4, 2), 16);
  const brightness = (c_r * 299 + c_g * 587 + c_b * 114) / 1000;
  return brightness < 128;
}

function millisecondsToNaturalLanguage(duration: number): string {
  const seconds = Math.floor((duration / 1000) % 60);
  const minutes = Math.floor((duration / (1000 * 60)) % 60);
  const hours = Math.floor((duration / (1000 * 60 * 60)) % 24);

  const parts = [];
  if (hours > 0) parts.push(hours + " hour" + (hours > 1 ? "s" : ""));
  if (minutes > 0) parts.push(minutes + " minute" + (minutes > 1 ? "s" : ""));
  // Only show seconds if less than 60 seconds remain
  if (duration < 60000)
    parts.push(seconds + " second" + (seconds > 1 ? "s" : ""));

  return parts.length > 0 ? parts.join(", ") : "0 seconds";
}

function isPostMadeToday(postDate: Date) {
  const today = new Date();
  return (
    postDate.getDate() === today.getDate() &&
    postDate.getMonth() === today.getMonth() &&
    postDate.getFullYear() === today.getFullYear()
  );
}

Devvit.configure({
  redditAPI: true,
  redis: true,
});

Devvit.addCustomPostType({
  name: "Place Mini",
  description: "A 16x16 grid where users can vote on the color of each pixel.",
  height: "tall",
  render: async (context) => {
    const { redis } = context;

    const post = await context.reddit.getPostById(context.postId || "");

    if (!post) {
      context.ui.showToast("Post not found");
      return;
    }

    const postDate = post.createdAt;

    // Initialize or retrieve grid from Redis
    const gridKey = `colorGrid_${context.postId}`;
    const votesKey = `colorVotes_${context.postId}`;
    const periodCloseKey = `colorPeriodClose_${context.postId}`;
    const gridHistoryKeyBase = `colorGridHistory_${context.postId}_`;
    const gridHistoryCountKey = `colorGridHistoryCount_${context.postId}`;

    let grid = [];
    let votes: Votes = {};
    let nextPeriodClose = parseInt((await redis.get(periodCloseKey)) || "0");
    if (!nextPeriodClose) {
      nextPeriodClose = Date.now() + VOTING_PERIOD_DURATION;
      await redis.set(periodCloseKey, nextPeriodClose + "");
    }
    let gridRes = await redis.get(gridKey);
    if (gridRes) {
      let originalGrid = JSON.parse(gridRes) as string[][];
      grid = adjustCanvasSize(originalGrid, N); // Adjust the canvas size to N x N
    } else {
      // If no grid exists in Redis, initialize a new N x N grid filled with white
      grid = Array.from({ length: N }, () => Array.from({ length: N }, () => "#FFFFFF"));
    }
    await redis.set(gridKey, JSON.stringify(grid));
    let votesRes = await redis.get(votesKey);
    if (votesRes) {
      votes = JSON.parse(votesRes);
    }

    let startFrame = parseInt((await redis.get(gridHistoryCountKey)) || "0");

    const [selectedPixel, setSelectedPixel] = context.useState<
      [number, number] | null
    >([0, 0]);
    const [localGrid, setLocalGrid] = context.useState<string[][]>(grid);
    const [countdown, setCountdown] = context.useState<number>(
      nextPeriodClose - Date.now()
    );
    const [maxFrame, setMaxFrame] = context.useState<number>(startFrame);
    const [selectedFrame, setSelectedFrame] = context.useState<number>(startFrame);

    const voteForColor = async (x: number, y: number, color: string) => {
      const voteKey = `${x},${y}`;

      // Get votes from Redis to ensure we have the latest data
      const votesRes = await redis.get(votesKey);
      if (votesRes) {
        const updatedVotes = JSON.parse(votesRes);
        votes = updatedVotes;
      }

      if (!votes[voteKey]) votes[voteKey] = {};

      // Initialize color vote detail if not present
      if (!votes[voteKey][color]) {
        votes[voteKey][color] = { count: 0, userIds: [] };
      }

      // Check if the selected color is the same as the current color of the pixel
      if (localGrid[x][y] === color) {
        context.ui.showToast("You cannot vote for the color the pixel already is.");
        return;
      }

      // Check if the user has already voted for this specific pixel in this period
      const userVote = Object.values(votes[voteKey]).some((voteDetail) =>
        voteDetail.userIds.includes(context.userId || "")
      );

      if (userVote) {
        // Inform the user they have already voted for this pixel in this period
        context.ui.showToast(
          "You have already voted for this pixel in this period."
        );
        return;
      }

      // Increment vote count and add user ID
      votes[voteKey][color].count += 1;
      votes[voteKey][color].userIds.push(context.userId || "");

      await redis.set(votesKey, JSON.stringify(votes));

      const updatedVotesRes = await redis.get(votesKey);
      if (updatedVotesRes) {
        const updatedVotes = JSON.parse(updatedVotesRes);
        votes = updatedVotes;
      }
    };

    // Periodically refresh the grid
    const checkGrid = context.useInterval(async () => {
      const now = Date.now();

      if (!isPostMadeToday(new Date(postDate))) {
        checkGrid.stop();
        return;
      }

      // Fetch the latest grid and votes from Redis at the beginning of each interval
      let latestGridRes = await redis.get(gridKey);
      let latestGrid = latestGridRes ? JSON.parse(latestGridRes) as string[][] : localGrid; // Use localGrid as fallback
      let latestVotesRes = await redis.get(votesKey);
      let latestVotes = latestVotesRes ? JSON.parse(latestVotesRes) as Votes : votes; // Use votes as fallback
      let periodClose = parseInt((await redis.get(periodCloseKey)) || "0");

      if (now >= periodClose) {
        // Process votes
        for (const [key, colorVotes] of Object.entries(latestVotes)) {
          const [x, y] = key.split(",").map(Number);
          let maxCount = 0;
          let winningColor = "#FFFFFF"; // Default color in case no votes are found
          for (const [color, { count }] of Object.entries(colorVotes)) {
            if (count > maxCount) {
              maxCount = count;
              winningColor = color;
            }
          }
          latestGrid[x][y] = winningColor;
        }
        // Reset votes
        latestVotes = {};
        await redis.set(votesKey, JSON.stringify(latestVotes));

        // Update grid
        await redis.set(gridKey, JSON.stringify(latestGrid));

        // Save winning frame
        const gridHistoryCount = parseInt((await redis.get(gridHistoryCountKey)) || "0") + 1;
        await redis.set(`${gridHistoryKeyBase}${gridHistoryCount}`, JSON.stringify(latestGrid));
        await redis.set(gridHistoryCountKey, gridHistoryCount.toString());

        // Fetch the latest grid from Redis after updating
        latestGridRes = await redis.get(gridKey);
        if (latestGridRes) {
          latestGrid = JSON.parse(latestGridRes);
        }

        setLocalGrid(latestGrid);
        setMaxFrame(gridHistoryCount);
        setSelectedFrame(gridHistoryCount);

        // Set next period close
        periodClose = now + VOTING_PERIOD_DURATION;
        await redis.set(periodCloseKey, periodClose.toString());
      }

      setCountdown(periodClose - now);
    }, UPDATE_RATE);

    const navigateFrames = async (direction: number) => {
      const newFrame = selectedFrame + direction;
      const gridHistoryCount = parseInt((await redis.get(gridHistoryCountKey)) || "0");
      if (newFrame < 0 || newFrame > gridHistoryCount) {
        return;
      }

      const newFrameRes = await redis.get(`${gridHistoryKeyBase}${newFrame}`);
      if (newFrameRes) {
        const newFrameData = JSON.parse(newFrameRes);
        setLocalGrid(newFrameData);
        setSelectedFrame(newFrame);
      }
    };

    checkGrid.start();

    const selectedPixelKey = selectedPixel
      ? `${selectedPixel[0]},${selectedPixel[1]}`
      : null;

    const userHasVotedForSelectedPixel =
      !!selectedPixelKey &&
      !!votes[selectedPixelKey] &&
      !!Object.values(votes[selectedPixelKey]).some((voteDetail) =>
        voteDetail.userIds.includes(context.userId || "")
      );

    return (
      <blocks>
        <vstack padding="large" alignment="center middle">
          <vstack backgroundColor="white" border="thin" borderColor="gray">
            {localGrid.map((row, rowIndex) => (
              <hstack>
                {row.map((color, colIndex) => (
                  <image
                    url={svg`<svg viewBox="0 0 10 10">
                        <rect fill="${color}" x="0" y="0" width="10" height="10" />
                        ${selectedPixel &&
                        selectedPixel[0] === rowIndex &&
                        selectedPixel[1] === colIndex
                        ? `<rect fill="none" stroke="gold" stroke-width="2" x="0" y="0" width="10" height="10" />`
                        : ""
                      }
                      </svg>`}
                    imageHeight={256 / N}
                    imageWidth={256 / N}
                    onPress={isPostMadeToday(new Date(postDate)) ? async () => {
                      setSelectedPixel([rowIndex, colIndex]);
                      const latestGridRes = await redis.get(gridKey);
                      if (latestGridRes) {
                        const latestGrid = JSON.parse(latestGridRes) as string[][];
                        setLocalGrid(latestGrid);
                      }
                      const latestVotesRes = await redis.get(votesKey);
                      if (latestVotesRes) {
                        const latestVotes = JSON.parse(latestVotesRes);
                        votes = latestVotes;
                      }
                    } : undefined}
                  />
                ))}
              </hstack>
            ))}
          </vstack>
          {selectedPixel && (
            <>
              <vstack padding="small">
                {Array.from({ length: 2 }, (_, i) => (
                  <hstack gap="small" padding="small">
                    {colors.slice(i * 8, (i + 1) * 8).map((color) => (
                      <image
                        onPress={isPostMadeToday(new Date(postDate)) && !userHasVotedForSelectedPixel ?
                          () => voteForColor(selectedPixel[0], selectedPixel[1], color) :
                          undefined}
                        url={svg`<svg viewBox="0 0 20 20">
                          <rect fill="${color}" x="0" y="0" width="20" height="20" />
                          ${userHasVotedForSelectedPixel &&
                            selectedPixel &&
                            votes[`${selectedPixel[0]},${selectedPixel[1]}`] &&
                            votes[`${selectedPixel[0]},${selectedPixel[1]}`][color]
                            ? `<rect fill="none" x="0" y="0" width="20" height="20" />`
                            : ""
                          }
                          <text x="10" y="15" font-size="15" fill="${isDark(color) ? "white" : "black"}" text-anchor="middle" font-family="monospace" font-weight="normal">${selectedPixel &&
                            votes[`${selectedPixel[0]},${selectedPixel[1]}`] &&
                            votes[`${selectedPixel[0]},${selectedPixel[1]}`][color]
                            ? votes[`${selectedPixel[0]},${selectedPixel[1]}`][color].count
                            : 0
                          }</text>
                        </svg>`}
                        imageHeight={20}
                        imageWidth={20}
                      />
                    ))}
                  </hstack>
                ))}
              </vstack>
              <hstack gap="small" alignment="middle">
                {!isPostMadeToday(new Date(postDate)) && startFrame > 0 && (
                  <button onPress={() => navigateFrames(-1)}>Previous</button>
                )}
                <text>
                  {isPostMadeToday(new Date(postDate)) ?
                    `${userHasVotedForSelectedPixel ? "Voted, " : ""}${millisecondsToNaturalLanguage(countdown)} remaining` :
                    startFrame > 0 ?
                      `Frame ${selectedFrame + 1} / ${maxFrame + 1}` :
                      "Voting has concluded"
                  }
                </text>
                {!isPostMadeToday(new Date(postDate)) && startFrame > 0 && (
                  <button onPress={() => navigateFrames(1)}>Next</button>
                )}
              </hstack>
            </>
          )}
        </vstack>
      </blocks>
    );
  },
});

Devvit.addMenuItem({
  location: "subreddit",
  label: "Create a Place Mini",
  forUserType: ["moderator"],
  onPress: async (_, context) => {
    const { reddit, ui } = context;
    const currentSubreddit = await reddit.getCurrentSubreddit();
    await reddit.submitPost({
      title: `Place Mini - ${new Date().toLocaleDateString()}`,
      subredditName: currentSubreddit.name,
      preview: (
        <vstack padding="medium">
          <text>Loading...</text>
        </vstack>
      ),
    });
    ui.showToast(
      `Created a new Place Mini post in ${currentSubreddit.name}`
    );
  },
});

Devvit.addSchedulerJob({
  name: 'daily-place-mini',
  onRun: async (job, context) => {
    const subreddit = await context.reddit.getCurrentSubreddit();
    await context.reddit.submitPost({
      title: `Place Mini - ${new Date().toLocaleDateString()}`,
      subredditName: subreddit.name,
      preview: (
        <vstack padding="medium">
          <text>Loading...</text>
        </vstack>
      ),
    });
  },
});

Devvit.addTrigger({
  events: ["AppInstall", "AppUpgrade"],
  onEvent: async (_, context) => {
    const jobs = await context.scheduler.listJobs();
    for (const job of jobs) {
      if ('cron' in job) {
        await context.scheduler.cancelJob(job.id);
      }
    }
    await context.scheduler.runJob({ cron: '0 0 * * *', name: 'daily-place-mini' });
  }
});

export default Devvit;
