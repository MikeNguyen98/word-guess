const readline = require("readline");
const axios = require("axios");
const { spawn } = require("child_process");
let ollamaProcess = null;

// Start Ollama server once
function startOllamaServer() {
  if (!ollamaProcess) {
    console.log("Starting Ollama server...");
    ollamaProcess = spawn("ollama", ["serve"]);
    return new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return Promise.resolve();
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const API_URL = process.env.API_URL || "https://wordle.votee.dev:8000";

async function guessWordDaily(guess, size) {
  try {
    const res = await axios.get(`${API_URL}/daily`, {
      params: { guess, size },
    });
    return res.data;
  } catch (error) {
    console.error("API Error:", error.message);
    return null;
  }
}

async function generateWordWithLLM(size, previousGuesses = [], previousFeedback = []) {
  await startOllamaServer();

  let prompt = `Generate a valid ${size}-letter English word. The word should be a common English word.`;

  if (previousGuesses.length > 0) {
    prompt += `\n\nI've already tried these words: ${previousGuesses.join(", ")}.`;
    prompt += `\n\nPrevious guesses and feedback (where \"correct\" means right letter in right position, \"present\" means right letter in wrong position, and \"absent\" means letter not in word):\n`;

    for (let i = 0; i < previousGuesses.length; i++) {
      prompt += `Guess: ${previousGuesses[i]}\nFeedback: ${JSON.stringify(previousFeedback[i])}\n`;
    }

    prompt += `\nBased on this feedback, provide a NEW ${size}-letter word I haven't tried yet. Just give me the word, no explanation.`;
  }

  try {
    console.log("Generating word with LLM...");
    const response = await fetch("http://localhost:11434/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "mistral",
        prompt: prompt,
        stream: false,
        temperature: 0.7,
        top_p: 0.9,
        max_tokens: 20,
      }),
    });

    const data = await response.json();
    const generatedText = data.response.trim().toLowerCase();
    const wordRegex = new RegExp(`\\b[a-z]{${size}}\\b`);
    const match = generatedText.match(wordRegex);
    let word = match ? match[0] : null;

    if (word && !previousGuesses.includes(word)) {
      return word;
    } else {
      console.log("Generated word was invalid or already used, retrying...");
      return await generateWordWithLLM(size, previousGuesses, previousFeedback);
    }
  } catch (error) {
    console.error("LLM Error:", error.message);
    return null;
  }
}

async function askForNumber() {
  rl.question("Please select Guess Size(5-22): ", async (input) => {
    const number = parseInt(input);
    if (isNaN(number) || number < 5 || number > 22) {
      console.log("Please enter a number between 5 and 22!");
      return askForNumber();
    }
    rl.close();
    console.log(`Starting game with ${number}-letter words...`);
    await playGame(number);
  });
}

async function playGame(size) {
  let win = false;
  let count = 0;
  let previousGuesses = [];
  let previousFeedback = [];

  console.log(`Trying to guess a ${size}-letter word...`);

  while (!win) {
    const guess = await generateWordWithLLM(size, previousGuesses, previousFeedback);
    console.log("🔍 LLM Guess:", guess);

    if (!guess) {
      console.log("Error generating word. Trying again...");
      continue;
    }

    const res = await guessWordDaily(guess, size);

    if (res) {
      count++;
      previousGuesses.push(guess);
      previousFeedback.push(res);

      if (res.every((item) => item.result === "correct")) {
        win = true;
        console.log("🎉 You won! The word is:", guess);
        console.log("Total Guesses:", count);
      } else {
        console.log("🚀 Guess Attempt:", res);
        console.log(`Attempt ${count}: ${guess}`);
      }
    } else {
      console.log("Failed to get response from API. Trying again...");
    }
  }

  if (ollamaProcess) {
    console.log("Stopping Ollama server...");
    ollamaProcess.kill();
  }
}

(async () => {
  await askForNumber();
})();