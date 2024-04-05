import express from "express";
import { jwtCheck, jwtParse } from "../middleware/auth";
import { createCheckoutSession, stripeWebhookHandler } from "../controllers/OrderController"; // Import both functions from OrderController

const router = express.Router();

router.post("/checkout/create-checkout-session", jwtCheck, jwtParse, createCheckoutSession); // Use the imported createCheckoutSession function

router.post("/checkout/webhook", stripeWebhookHandler); // Use the imported stripeWebhookHandler function

export default router;
