/**
 * pi-wordle — daily word puzzle. /wordle
 * 6 guesses to find a 5-letter word. Color-coded feedback.
 * Daily seed = same puzzle for everyone. /wordle random for infinite mode.
 */
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const SAVE_DIR = join(homedir(), ".pi", "wordle");
const SAVE_FILE = join(SAVE_DIR, "save.json");
const MAX_GUESSES = 6;
const WORD_LEN = 5;

// Curated 200-word list — common, fair words
const WORDS = [
  "about","above","abuse","actor","acute","admit","adopt","adult","after","again",
  "agent","agree","ahead","alarm","album","alert","alien","align","alive","allow",
  "alone","along","alter","among","angel","anger","angle","angry","apart","apple",
  "arena","argue","arise","aside","asset","avoid","award","aware","basic","beach",
  "began","begin","being","below","bench","birth","black","blade","blame","blank",
  "blast","blaze","bleed","blend","blind","block","blood","bloom","blown","board",
  "bonus","booth","bound","brain","brand","brave","bread","break","breed","brick",
  "brief","bring","broad","broke","brown","brush","build","burst","buyer","cable",
  "cargo","carry","catch","cause","chain","chair","chalk","chaos","charm","chase",
  "cheap","check","chess","chief","child","chill","china","choir","chunk","civic",
  "claim","clash","class","clean","clear","climb","cling","clock","clone","close",
  "cloth","cloud","coach","coast","coral","count","court","cover","crack","craft",
  "crane","crash","crazy","cream","crime","crisp","cross","crowd","crown","crush",
  "curve","cycle","daily","dance","death","decay","delay","delta","dense","depot",
  "depth","devil","diary","dirty","donor","doubt","dough","draft","drain","drama",
  "drank","drawn","dream","dress","dried","drift","drill","drink","drive","drone",
  "drove","drown","dying","early","earth","eight","elect","elite","empty","enemy",
  "enjoy","enter","equal","error","event","every","exact","exist","extra","faint",
  "faith","fault","feast","fiber","field","fifth","fifty","fight","final","flame",
  "flash","fleet","flesh","float","flood","floor","flour","fluid","flush","flute",
];

function getDailyWord(): string {
  const d = new Date();
  const seed = d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
  return WORDS[seed % WORDS.length];
}

function getRandomWord(): string {
  return WORDS[Math.floor(Math.random() * WORDS.length)];
}

interface SaveData { played: number; won: number; streak: number; maxStreak: number; dist: number[]; lastDay: string }

function loadSave(): SaveData {
  try { if (existsSync(SAVE_FILE)) return JSON.parse(readFileSync(SAVE_FILE, "utf-8")); } catch {}
  return { played: 0, won: 0, streak: 0, maxStreak: 0, dist: [0, 0, 0, 0, 0, 0], lastDay: "" };
}

function saveSave(d: SaveData) {
  try { mkdirSync(SAVE_DIR, { recursive: true }); writeFileSync(SAVE_FILE, JSON.stringify(d)); } catch {}
}

const RST = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const GREEN_BG = "\x1b[42;30m";  // correct position
const YELLOW_BG = "\x1b[43;30m"; // wrong position
const GRAY_BG = "\x1b[100;37m";  // not in word
const WHITE = "\x1b[37m";

function gradeGuess(guess: string, answer: string): ("correct" | "present" | "absent")[] {
  const result: ("correct" | "present" | "absent")[] = Array(WORD_LEN).fill("absent");
  const ansChars = answer.split("");
  const remaining: string[] = [];

  // First pass: mark correct
  for (let i = 0; i < WORD_LEN; i++) {
    if (guess[i] === answer[i]) { result[i] = "correct"; ansChars[i] = ""; }
    else remaining.push(ansChars[i]);
  }
  // Second pass: mark present
  for (let i = 0; i < WORD_LEN; i++) {
    if (result[i] !== "correct") {
      const idx = remaining.indexOf(guess[i]);
      if (idx >= 0) { result[i] = "present"; remaining.splice(idx, 1); }
    }
  }
  return result;
}

function renderTile(ch: string, grade: "correct" | "present" | "absent" | "empty"): string {
  const c = ch.toUpperCase();
  if (grade === "correct") return `${GREEN_BG} ${c} ${RST}`;
  if (grade === "present") return `${YELLOW_BG} ${c} ${RST}`;
  if (grade === "absent") return `${GRAY_BG} ${c} ${RST}`;
  return `${DIM} ${c || "_"} ${RST}`;
}

export default function piWordle(pi: ExtensionAPI) {
  pi.registerCommand("wordle", {
    description: "Play Wordle! Guess a 5-letter word in 6 tries. /wordle [random]",
    execute: async (ctx, args) => {
      if (!ctx.hasUI) { ctx.ui.notify("Wordle requires interactive mode", "error"); return; }

      const isRandom = args.trim().toLowerCase() === "random";
      const answer = isRandom ? getRandomWord() : getDailyWord();
      const guesses: { word: string; grades: ("correct" | "present" | "absent")[] }[] = [];
      const keyboard: Record<string, "correct" | "present" | "absent" | "unused"> = {};
      "abcdefghijklmnopqrstuvwxyz".split("").forEach(c => keyboard[c] = "unused");
      let currentInput = "";
      let message = "";
      let gameOver = false;
      let won = false;
      const save = loadSave();

      await ctx.ui.custom((tui: any, _t: any, _k: any, done: (v: undefined) => void) => {
        function handleInput(data: string) {
          if (data === "q" || data === "Q" || data === "\x03") { done(undefined); return; }
          if (gameOver) {
            if (data === "r" || data === "R") {
              // Only restart in random mode
              if (isRandom) {
                const newAnswer = getRandomWord();
                Object.assign(answer, {}); // can't reassign const, use closure trick below
                guesses.length = 0;
                "abcdefghijklmnopqrstuvwxyz".split("").forEach(c => keyboard[c] = "unused");
                currentInput = ""; message = ""; gameOver = false; won = false;
                // Workaround: re-enter the command
                done(undefined);
              }
              return;
            }
            return;
          }
          if (data === "\x7f" || data === "\b") { // backspace
            currentInput = currentInput.slice(0, -1); tui.requestRender(); return;
          }
          if (data === "\r" || data === "\n") { // enter = submit
            if (currentInput.length < WORD_LEN) { message = "Not enough letters"; tui.requestRender(); return; }
            const guess = currentInput.toLowerCase();
            const grades = gradeGuess(guess, answer);
            guesses.push({ word: guess, grades });
            // Update keyboard
            for (let i = 0; i < WORD_LEN; i++) {
              const ch = guess[i];
              const g = grades[i];
              if (g === "correct") keyboard[ch] = "correct";
              else if (g === "present" && keyboard[ch] !== "correct") keyboard[ch] = "present";
              else if (g === "absent" && keyboard[ch] === "unused") keyboard[ch] = "absent";
            }
            currentInput = "";
            message = "";
            if (grades.every(g => g === "correct")) {
              won = true; gameOver = true;
              message = ["Genius!", "Magnificent!", "Impressive!", "Splendid!", "Great!", "Phew!"][guesses.length - 1];
              if (!isRandom) {
                const today = new Date().toISOString().slice(0, 10);
                if (save.lastDay !== today) {
                  save.played++; save.won++; save.streak++;
                  save.maxStreak = Math.max(save.maxStreak, save.streak);
                  save.dist[guesses.length - 1]++;
                  save.lastDay = today;
                  saveSave(save);
                }
              }
            } else if (guesses.length >= MAX_GUESSES) {
              gameOver = true;
              message = `The word was: ${BOLD}${answer.toUpperCase()}${RST}`;
              if (!isRandom) {
                const today = new Date().toISOString().slice(0, 10);
                if (save.lastDay !== today) {
                  save.played++; save.streak = 0; save.lastDay = today;
                  saveSave(save);
                }
              }
            }
            tui.requestRender(); return;
          }
          // Letter input
          const ch = data.toLowerCase();
          if (/^[a-z]$/.test(ch) && currentInput.length < WORD_LEN) {
            currentInput += ch; message = ""; tui.requestRender();
          }
        }

        let version = 0;
        function render(width: number): string[] {
          const lines: string[] = [];
          const pad = (s: string) => "  " + s;

          lines.push("");
          lines.push(pad(`${BOLD}W O R D L E${RST}  ${isRandom ? DIM + "(random)" + RST : DIM + new Date().toLocaleDateString() + RST}`));
          lines.push("");

          // Grid
          for (let row = 0; row < MAX_GUESSES; row++) {
            let rowStr = "  ";
            if (row < guesses.length) {
              for (let col = 0; col < WORD_LEN; col++) {
                rowStr += renderTile(guesses[row].word[col], guesses[row].grades[col]) + " ";
              }
            } else if (row === guesses.length && !gameOver) {
              for (let col = 0; col < WORD_LEN; col++) {
                rowStr += renderTile(currentInput[col] || "", "empty") + " ";
              }
            } else {
              for (let col = 0; col < WORD_LEN; col++) {
                rowStr += renderTile("", "empty") + " ";
              }
            }
            lines.push(rowStr);
          }

          lines.push("");

          // Message
          if (message) lines.push(pad(won ? `\x1b[32;1m${message}${RST}` : `\x1b[33m${message}${RST}`));
          else lines.push("");

          // Keyboard
          const kbRows = ["qwertyuiop", "asdfghjkl", "zxcvbnm"];
          for (const row of kbRows) {
            let kbStr = "  ";
            for (const ch of row) {
              const st = keyboard[ch];
              const bg = st === "correct" ? GREEN_BG : st === "present" ? YELLOW_BG : st === "absent" ? GRAY_BG : `${DIM}`;
              kbStr += `${bg} ${ch.toUpperCase()} ${RST}`;
            }
            lines.push(kbStr);
          }

          lines.push("");
          // Stats
          if (!isRandom) {
            lines.push(pad(`${DIM}Played: ${save.played}  Won: ${save.won}  Streak: ${save.streak}  Max: ${save.maxStreak}${RST}`));
          }
          // Help
          lines.push(pad(`${DIM}Type a word + Enter | Backspace to delete | Q to quit${gameOver && isRandom ? " | R for new word" : ""}${RST}`));
          lines.push("");

          return lines;
        }

        return {
          handleInput,
          render,
          invalidate() {},
          dispose() {},
          get version() { return version; },
        };
      });
    },
  });
}
