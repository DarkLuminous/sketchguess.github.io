// ─── server/wordList.js ───────────────────────────────────────────────────────
// CS323: Shared resource accessed concurrently by multiple rooms.
// Demonstrates shared state management — all rooms pull from this single pool.

const EASY_WORDS = [
  "apple", "banana", "cherry", "grape", "orange", "lemon", "strawberry", "watermelon",
  "pizza", "burger", "fries", "taco", "sushi", "cake", "cookie", "ice cream",
  "cat", "dog", "bird", "fish", "lion", "elephant", "giraffe", "zebra", "monkey",
  "frog", "rabbit", "mouse", "snake", "butterfly", "bee", "spider", "dinosaur",
  "car", "bus", "train", "airplane", "helicopter", "bicycle", "motorcycle", "boat",
  "house", "school", "castle", "tent", "igloo", "skyscraper", "bridge", "lighthouse",
  "sun", "moon", "star", "cloud", "rainbow", "thunderstorm", "snowflake", "tornado",
  "tree", "flower", "grass", "mountain", "river", "ocean", "desert", "volcano",
  "heart", "smiley", "ghost", "robot", "alien", "dragon", "unicorn", "fairy",
  "ball", "kite", "balloon", "gift", "clock", "book", "pen", "scissors",
  "computer", "phone", "camera", "television", "lamp", "chair", "table", "bed",
  "cup", "plate", "fork", "knife", "spoon", "bowl", "bottle", "glass",
  "shoe", "shirt", "hat", "pants", "dress", "glasses", "watch", "backpack",
  "key", "lock", "umbrella", "candle", "flashlight", "hammer", "screwdriver", "paintbrush",
  "sword", "shield", "crown", "treasure", "map", "compass", "binoculars", "telescope",
  "rocket", "spaceship", "astronaut", "satellite", "planet", "comet", "UFO",
  "snowman", "santa", "pumpkin", "witch", "bat", "spiderweb", "candy", "lollipop",
  "milk", "cheese", "bread", "egg", "bacon", "salad", "soup", "sandwich",
  "toothbrush", "soap", "towel", "mirror", "comb", "shampoo", "razor", "toothpaste",
  "football", "baseball", "basketball", "soccer", "tennis", "golf", "hockey", "skateboard",
  "dolphin", "whale", "shark", "octopus", "crab", "jellyfish", "starfish", "seahorse",
  "cactus", "palm tree", "sunflower", "rose", "tulip", "daisy", "mushroom", "bamboo",
  "penguin", "polar bear", "koala", "kangaroo", "panda", "sloth", "otter", "hedgehog",
  "donut", "croissant", "bagel", "muffin", "pie", "brownie", "pancake", "waffle",
  "fire", "water", "earth", "wind", "rain", "snow", "ice", "steam"
];

function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// CS323: Shared mutable state — this pool is shared across all rooms on the server.
let wordPool = shuffleArray([...EASY_WORDS]);

function ensureWordPool() {
  if (wordPool.length < 20) {
    wordPool = shuffleArray([...EASY_WORDS]);
    console.log(`[WordPool] Refilled with ${wordPool.length} words.`);
  }
}

function getRandomWord() {
  ensureWordPool();
  const index = Math.floor(Math.random() * wordPool.length);
  const word = wordPool[index];
  wordPool.splice(index, 1); // remove to avoid immediate repeat across rooms
  return word;
}

console.log(`[WordList] Loaded ${EASY_WORDS.length} words.`);

module.exports = { getRandomWord, WORD_COUNT: EASY_WORDS.length };