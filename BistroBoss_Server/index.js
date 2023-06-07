const express = require("express");
const jwt = require("jsonwebtoken");
const cors = require("cors");
const app = express();
const stripe = require("stripe")(
  "sk_test_51NFr2tKPWyqKt9TkCfoAFaH6Yzs2Oelb2Oz3HWBvqzOEC06ktGvRQwtfpbNS9i1UkU0HVCGjr6vkGdLfIidHVKNo00gJCIRik8"
);

require("dotenv").config();

app.use(cors());
app.use(express.json());

const port = 3000;

const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const uri = `mongodb+srv://${process.env.USER_NAME}:${process.env.USER_PASSWORD}@cardoctorcluster.wnssc2r.mongodb.net/?retryWrites=true&w=majority`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

const kungfuMenu = client.db("bistroDB").collection("menu");
const kungfuReviews = client.db("bistroDB").collection("reviews");
const kungfuCards = client.db("bistroDB").collection("cards");
const kungfuUsers = client.db("bistroDB").collection("users");
const kungfuPayments = client.db("bistroDB").collection("payments");

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();

    ///////////////// JWT ////////////////////////////

    const varifyJWT = (req, res, next) => {
      const authorization = req.headers.authorization;
      // console.log({authorization})
      if (!authorization) {
        return res.status(401).send({ error: true, message: "unauthorised access" });
      }
      // bearer token
      const token = authorization.split(" ")[1];
      console.log({ token });
      jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decode) => {
        if (err) {
          return res.status(401).send({ error: true, message: "unauthorised access" });
        } else {
          req.decoded = decode;
          next();
        }
      });
    };

    /////////////////////////////////////////////////

    const varifyAdmin = async (req, res, next) => {
      const email = req.decoded.email;
      const query = { email: email };
      const user = await kungfuUsers.findOne(query);
      if (user?.role !== "admin") {
        return res.status(403).send({ error: true, message: "forbidden" });
      }
      next();
    };

    ///////////////// Users ///////////////////////////

    app.get("/users", varifyJWT, varifyAdmin, async (req, res) => {
      const cursor = await kungfuUsers.find().toArray();
      res.send(cursor);
    });

    app.post("/users", async (req, res) => {
      const doc = req.body;
      const query = { email: doc.email };
      const existingUser = await kungfuUsers.findOne(query);

      if (!existingUser) {
        const cursor = await kungfuUsers.insertOne(doc);
        res.send(cursor);
      } else {
        return res.send({ message: "user already exists" });
      }
    });

    app.patch("/users/admin/:id", async (req, res) => {
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) };
      const updateDoc = {
        $set: {
          role: "admin",
        },
      };

      const result = await kungfuUsers.updateOne(filter, updateDoc);
      res.send(result);
    });

    app.get("/users/admin/:email", varifyJWT, async (req, res) => {
      const email = req.params.email;
      if (req.decoded.email !== email) {
        return res.send({ admin: false });
      }

      const query = { email: email };
      const user = await kungfuUsers.findOne(query);
      const result = { admin: user?.role === "admin" };
      return res.send(result);
    });

    app.delete("/users/:id", async (req, res) => {
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) };
      const cursor = await kungfuUsers.deleteOne(filter);
      res.send(cursor);
    });

    app.post("/jwt", async (req, res) => {
      const user = req.body;
      const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: "5h",
      });
      res.send({ token });
    });

    ///////////////// Menu ///////////////////////////

    app.get("/menu", async (req, res) => {
      const cursor = await kungfuMenu.find().toArray();
      res.send(cursor);
    });

    app.post("/menu", varifyJWT, varifyAdmin, async (req, res) => {
      const data = req.body;
      const cursor = await kungfuMenu.insertOne(data);
      res.send(cursor);
    });

    app.delete("/menu/:id", varifyJWT, varifyAdmin, async (req, res) => {
      const dId = req.params.id;
      const queryId = { _id: new ObjectId(dId) };
      const cursor = await kungfuMenu.deleteOne(queryId);
      res.send(cursor);
    });

    ///////////////// Carts ///////////////////////////

    app.post("/carts", async (req, res) => {
      const doc = req.body;
      const cursor = await kungfuCards.insertOne(doc);
      res.send(cursor);
    });

    app.get("/carts", varifyJWT, async (req, res) => {
      const qEmail = req.query.email;

      if (!qEmail) {
        res.send([]);
      }
      const decodedEmail = req.decoded.email;

      if (qEmail !== decodedEmail) {
        return res.status(403).send({ error: true, message: "forbidden access" });
      }

      const query = { email: qEmail };
      const cursor = await kungfuCards.find(query).toArray();
      res.send(cursor);
    });

    app.delete("/carts/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const cursor = await kungfuCards.deleteOne(query);
      res.send(cursor);
    });

    // STRIPE PAYMENT

    app.post("/create-payment-intent", varifyJWT, async (req, res) => {
      const { price } = req.body;
      const bestPrice = parseInt(price * 100);

      if (bestPrice < 1) {
        return res.send();
      }

      // Create a PaymentIntent with the order amount and currency
      const paymentIntent = await stripe.paymentIntents.create({
        amount: bestPrice,
        currency: "usd",
        payment_method_types: ["card"],
      });

      res.send({
        clientSecret: paymentIntent.client_secret,
      });
    });

    /////////////////  Payment related api //////////////

    app.post("/payments", varifyJWT, async (req, res) => {
      const payment = req.body;
      const insertResult = await kungfuPayments.insertOne(payment);
      const query = { _id: { $in: payment.cartItems.map((id) => new ObjectId(id)) } };
      // console.log(query)
      const deletedResult = await kungfuCards.deleteMany(query);
      res.send({insertResult, deletedResult});
      // res.send([])
    });

    ////////////////////////////////////////////////////////////

    app.get("/admin-stats", async (req, res) => {
      const users = await kungfuUsers.estimatedDocumentCount();
      const products = await kungfuMenu.estimatedDocumentCount();
      const orders = await kungfuPayments.estimatedDocumentCount();

      const payment = await kungfuPayments.find().toArray();
      const revenue = payment.reduce((sum, add) => sum + add.price, 0);

      res.send({users, products, orders, revenue});
    });

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Hello World!");
});

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
