require("dotenv").config();

fetch("https://api.elevenlabs.io/v1/voices", {
  headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY }
})
  .then(r => r.json())
  .then(console.log)
  .catch(console.error);
