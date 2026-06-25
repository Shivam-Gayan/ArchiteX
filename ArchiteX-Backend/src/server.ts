// src/interfaces/http/server.ts
import express from "express";
import cors from "cors";
import routes from "../routes/api.routes.ts";

const app = express();

app.use(cors());
app.use(express.json());

app.use("/api/v1", routes);

app.listen(4000, () => {
  console.log("Server is running on port 4000");
});

export default app;