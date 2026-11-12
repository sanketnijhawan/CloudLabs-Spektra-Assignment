import { seed, getDashboard } from "../server/db.mjs";
const changed = seed(true);
console.log(changed ? "Reseeded 120 environments." : "No changes.");
console.log(`Session has ${getDashboard().session.total} learners.`);
