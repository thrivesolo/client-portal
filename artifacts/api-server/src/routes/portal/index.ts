import { Router, type IRouter } from "express";
import express from "express";
import adminRouter from "./admin";
import clientRouter from "./client";

const router: IRouter = Router();

router.use("/portal", clientRouter);
router.use("/portal", express.json(), adminRouter);

export default router;
