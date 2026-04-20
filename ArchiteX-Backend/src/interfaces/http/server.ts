// src/interfaces/http/server.ts
import express from "express";
import cors from "cors";
import routes from "./routes/api.routes";

const app = express();

app.use(cors());
app.use(express.json());

app.use("/api/v1", routes);

export default app;