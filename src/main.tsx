import { Devvit, svg } from "@devvit/public-api";

const VOTING_PERIOD_DURATION = 5 * 60 * 1000;
const UPDATE_RATE = 1000;

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

Devvit.configure({
  redditAPI: true,
  redis: true,
});

Devvit.addCustomPostType({
  name: "Pixel Art Collab",
  description: "A 16x16 grid where users can vote on the color of each pixel.",
  height: "tall",
  render: async (context) => {
    const { redis } = context;

    // Initialize or retrieve grid from Redis
    const gridKey = `colorGrid_${context.postId}`;
    const votesKey = `colorVotes_${context.postId}`;
    const periodCloseKey = `colorPeriodClose_${context.postId}`;
    let grid = [];
    let votes: Votes = {};
    let nextPeriodClose = parseInt(await redis.get(periodCloseKey) || "0");
    if (!nextPeriodClose) {
      nextPeriodClose = Date.now() + VOTING_PERIOD_DURATION;
      await redis.set(periodCloseKey, nextPeriodClose + "");
    }
    let gridRes = await redis.get(gridKey);
    if (!gridRes) {
      grid = Array.from(
        { length: 16 },
        () => Array.from({ length: 16 }, () => "#FFFFFF") // Start as white
      );
      await redis.set(gridKey, JSON.stringify(grid));
    } else {
      grid = JSON.parse(gridRes) as string[][];
    }
    let votesRes = await redis.get(votesKey);
    if (votesRes) {
      votes = JSON.parse(votesRes);
    }

    const [selectedPixel, setSelectedPixel] = context.useState<
      [number, number] | null
    >([0, 0]);
    const [selectedColor, setSelectedColor] = context.useState<string>("");
    const [localGrid, setLocalGrid] = context.useState<string[][]>(grid);
    const [countdown, setCountdown] = context.useState<number>(
      nextPeriodClose - Date.now()
    );

    const voteForColor = async (x: number, y: number, color: string) => {
      const voteKey = `${x},${y}`;
      if (!votes[voteKey]) votes[voteKey] = {};

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

      // Initialize color vote detail if not present
      if (!votes[voteKey][color]) {
        votes[voteKey][color] = { count: 0, userIds: [] };
      }

      // Increment vote count and add user ID
      votes[voteKey][color].count += 1;
      votes[voteKey][color].userIds.push(context.userId || "");

      await redis.set(votesKey, JSON.stringify(votes));
    };

    // Periodically refresh the grid
    const checkGrid = context.useInterval(async () => {
      const now = Date.now();
      let latestGrid = JSON.parse((await redis.get(gridKey)) || "[]") as string[][];
      let latestVotes = JSON.parse((await redis.get(votesKey)) || "{}") as Votes;
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
        setLocalGrid(latestGrid);

        // Set next period close
        periodClose = now + VOTING_PERIOD_DURATION;
        await redis.set(periodCloseKey, periodClose.toString());
      }

      setCountdown(periodClose - now);
    }, UPDATE_RATE);

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
        <vstack padding="medium" alignment="center middle">
          <vstack backgroundColor="white" border="thin" borderColor="gray">
            {localGrid.map((row, rowIndex) => (
              <hstack>
                {row.map((color, colIndex) => (
                  <image
                    url={svg`<svg viewBox="0 0 10 10">
                        <rect fill="${color}" x="0" y="0" width="10" height="10" />
                        ${
                          selectedPixel &&
                          selectedPixel[0] === rowIndex &&
                          selectedPixel[1] === colIndex
                            ? `<rect fill="none" stroke="gold" stroke-width="2" x="0" y="0" width="10" height="10" />`
                            : ""
                        }
                      </svg>`}
                    imageHeight={16}
                    imageWidth={16}
                    onPress={() => {
                      setSelectedPixel([rowIndex, colIndex]);
                    }}
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
                        onPress={() => {
                          setSelectedColor(color);
                        }}
                        url={svg`<svg viewBox="0 0 20 20">
          <rect fill="${color}" x="0" y="0" width="20" height="20" />
          ${
            selectedColor === color
              ? `<rect fill="none" stroke="gold" stroke-width="4" x="0" y="0" width="20" height="20" />`
              : ""
          }
          <text x="10" y="15" font-size="${
            `${
              selectedPixel &&
              votes[`${selectedPixel[0]},${selectedPixel[1]}`] &&
              votes[`${selectedPixel[0]},${selectedPixel[1]}`][color]
                ? votes[`${selectedPixel[0]},${selectedPixel[1]}`][color].count
                : 0
            }`.length === 1
              ? "15"
              : `${
                  selectedPixel &&
                  votes[`${selectedPixel[0]},${selectedPixel[1]}`] &&
                  votes[`${selectedPixel[0]},${selectedPixel[1]}`][color]
                    ? votes[`${selectedPixel[0]},${selectedPixel[1]}`][color]
                        .count
                    : 0
                }`.length === 2
              ? "12"
              : "8"
          }" fill="${
                          isDark(color) ? "white" : "black"
                        }" text-anchor="middle" font-family="monospace">${
                          selectedPixel &&
                          votes[`${selectedPixel[0]},${selectedPixel[1]}`] &&
                          votes[`${selectedPixel[0]},${selectedPixel[1]}`][
                            color
                          ]
                            ? votes[`${selectedPixel[0]},${selectedPixel[1]}`][
                                color
                              ].count
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
              <vstack>
                <button
                  onPress={() => {
                    voteForColor(
                      selectedPixel[0],
                      selectedPixel[1],
                      selectedColor
                    );
                  }}
                  disabled={!selectedColor || userHasVotedForSelectedPixel}
                >
                  {userHasVotedForSelectedPixel
                    ? `Your vote will be counted in ${millisecondsToNaturalLanguage(
                        Math.max(0, countdown)
                      )}`
                    : "Vote"}
                </button>
              </vstack>
            </>
          )}
        </vstack>
      </blocks>
    );
  },
});

Devvit.addMenuItem({
  location: "subreddit",
  label: "Create a Pixel Art Collab",
  forUserType: ["moderator"],
  onPress: async (_, context) => {
    const { reddit, ui } = context;
    const currentSubreddit = await reddit.getCurrentSubreddit();
    await reddit.submitPost({
      title: `Pixel Art Collab - ${new Date().toLocaleDateString()}`,
      subredditName: currentSubreddit.name,
      preview: (
        <vstack padding="medium">
          <text>Loading...</text>
        </vstack>
      ),
    });
    ui.showToast(
      `Created a new Pixel Art Collab post in ${currentSubreddit.name}`
    );
  },
});

export default Devvit;
