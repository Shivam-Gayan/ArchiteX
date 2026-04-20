// src/index.ts
import app from "./interfaces/http/server";

const PORT = 4000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});