import express from 'express';
import { protect } from '../middlewares/auth.js';
import { generateComponent } from '../controllers/componentController.js';

const componentRouter = express.Router();

componentRouter.post('/generate', protect, generateComponent);

export default componentRouter;
