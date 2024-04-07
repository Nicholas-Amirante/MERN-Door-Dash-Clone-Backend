import Stripe from "stripe";
import { Request, Response } from "express";
import Restaurant, { MenuItemType } from "../models/restaurant";
import Order from "../models/order";

const STRIPE = new Stripe(process.env.STRIPE_API_KEY as string);
const FRONTEND_URL = process.env.FRONTEND_URL as string;
const STRIPE_ENDPOINT_SECRET = process.env.STRIPE_WEBHOOK_SECRET as string;


const getMyOrders = async (req: Request, res: Response) => {
  try {
    const orders = await Order.find({user: req.userId}).populate("restaurant").populate("user");

    res.json(orders);
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: "something went wrong"})
  }
}


type CheckoutSessionRequest = {
  cartItems: {
    menuItemId: string;
    name: string;
    quantity: string;
  }[];
  deliveryDetails: {
    email: string;
    name: string;
    addressLine1: string;
    city: string;
  };
  restaurantId: string;
};

const stripeWebhookHandler = async (req: Request, res: Response) => {
  let event;

  try {
    const sig = req.headers["stripe-signature"];
    event = STRIPE.webhooks.constructEvent(req.body, sig as string, STRIPE_ENDPOINT_SECRET);
  } catch (error: any) {
    console.error("Error parsing webhook event:", error);
    console.error("Raw request body:", req.body); // Log raw request body for debugging
    return res.status(400).send(`Webhook error: ${error.message}`);
  }

  if (event.type === "checkout.session.completed") {
    try {
      const orderId = event.data.object.metadata?.orderId;
      if (!orderId) {
        console.error("Missing orderId in webhook metadata");
        return res.status(400).json({ message: "Missing orderId in webhook metadata" });
      }

      const order = await Order.findById(orderId);
      if (!order) {
        console.error("Order not found:", orderId);
        return res.status(404).json({ message: "Order not found" });
      }

      order.totalAmount = event.data.object.amount_total;
      order.status = "paid";

      await order.save();
      console.log("Order marked as paid:", orderId);
    } catch (error) {
      console.error("Error updating order status:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  }

  res.status(200).send();
};

const createCheckoutSession = async (req: Request, res: Response) => {
  try {
    const checkoutSessionRequest: CheckoutSessionRequest = req.body;
    const restaurant = await Restaurant.findById(checkoutSessionRequest.restaurantId);

    if (!restaurant) {
      return res.status(404).json({ message: "Restaurant not found" });
    }

    const newOrder = new Order({
      restaurant: restaurant,
      user: req.userId,
      status: "placed",
      deliveryDetails: checkoutSessionRequest.deliveryDetails,
      cartItems: checkoutSessionRequest.cartItems,
      createdAt: new Date(),
    });

    const lineItems = createLineItems(checkoutSessionRequest.cartItems, restaurant.menuItems);

    const session = await createSession(lineItems, newOrder._id.toString(), restaurant.deliveryPrice, restaurant._id.toString());

    if (!session.url) {
      return res.status(500).json({ message: "Error creating Stripe session" });
    }

    await newOrder.save();

    res.json({ url: session.url });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Internal server error" });
  }
};

const createLineItems = (cartItems: CheckoutSessionRequest["cartItems"], menuItems: MenuItemType[]) => {
  return cartItems.map((cartItem) => {
    const menuItem = menuItems.find((item) => item._id.toString() === cartItem.menuItemId.toString());
    if (!menuItem) {
      throw new Error(`Menu item not found: ${cartItem.menuItemId}`);
    }

    return {
      price_data: {
        currency: "usd",
        unit_amount: menuItem.price * 100, // Convert price to cents
        product_data: {
          name: menuItem.name,
        },
      },
      quantity: parseInt(cartItem.quantity),
    };
  });
};

const createSession = async (
  lineItems: Stripe.Checkout.SessionCreateParams.LineItem[],
  orderId: string,
  deliveryPrice: number,
  restaurantId: string
) => {
  try {
    const sessionData = await STRIPE.checkout.sessions.create({
      line_items: lineItems,
      shipping_options: [
        {
          shipping_rate_data: {
            display_name: "Delivery",
            type: "fixed_amount",
            fixed_amount: {
              amount: deliveryPrice * 100, // Convert delivery price to cents
              currency: "usd",
            },
          },
        },
      ],
      mode: "payment",
      metadata: {
        orderId,
        restaurantId,
      },
      success_url: `${FRONTEND_URL}/order-status?success=true`,
      cancel_url: `${FRONTEND_URL}/detail/${restaurantId}?cancelled=true`,
    });

    return sessionData;
  } catch (error: any) {
    throw new Error("Failed to create session: " + error.message);
  }
};

export { getMyOrders, createCheckoutSession, stripeWebhookHandler };
