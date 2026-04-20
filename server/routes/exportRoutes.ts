import express from 'express';
import { protect } from '../middlewares/auth.js';
import { exportProject } from '../controllers/exportController.js';

const exportRouter = express.Router();

exportRouter.get('/:projectId', protect, exportProject);

export default exportRouter;
