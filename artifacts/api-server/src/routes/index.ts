import { Router, type IRouter } from "express";
import express from "express";
import healthRouter from "./health";
import portalRouter from "./portal";

const router: IRouter = Router();

router.use(portalRouter);
router.use(express.json(), healthRouter);

export default router;
