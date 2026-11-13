import { Router, type IRouter } from "express";
import healthRouter from "./health";
import cleoRouter from "./cleo";

const router: IRouter = Router();

router.use(healthRouter);
router.use(cleoRouter);

export default router;
