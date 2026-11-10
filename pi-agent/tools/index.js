import uploadsTool from "./uploads.js";
import homeassistantTool from "./homeassistant.js";
import musicTool from "./music.js";
import timerTool from "./timer.js";
import weatherTool from "./weather.js";
import newsTool from "./news.js";
import notesTool from "./notes.js";
import calendarTool from "./calendar.js";
import routinesTool from "./routines.js";
import listsTool from "./lists.js";
import weekplannerTool from "./weekplanner.js";
import searchTool from "./search.js";
import imagegenTool from "./imagegen.js";
import flashcardsTool from "./flashcards.js";
import adminTool from "./admin.js";
import developTool from "./develop.js";
import capabilitiesTool from "./capabilities.js";
import cookingTool from "./cooking.js";
import expensesTool from "./expenses.js";
import personalityTool from "./personality.js";
import memoryTool from "./memory.js";
import filesTool from "./files.js";
import projectsTool from "./projects.js";
import proactiveRulesTool from "./proactive_rules.js";
import video from "./video.js";


export const coreTools = [uploadsTool,proactiveRulesTool, video, homeassistantTool, musicTool, timerTool, weatherTool, newsTool, notesTool, calendarTool, routinesTool, listsTool, weekplannerTool, searchTool, imagegenTool, flashcardsTool, cookingTool, expensesTool, personalityTool, memoryTool, filesTool, projectsTool, adminTool, developTool, capabilitiesTool];

const names = coreTools.map(tool => tool.name);
if (new Set(names).size !== names.length) throw new Error("Doppelte Core-Tool-Namen");
Object.freeze(coreTools);
