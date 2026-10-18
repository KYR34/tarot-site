// Netlify Function: PayPal orders for three products:
//   spread  -> three-card spread, $1 USD
//   outlook -> full year outlook, $3 USD
//   support -> optional donation, custom amount from $1 to $100 USD
// Environment variables (set in Netlify, never in the HTML):
//   PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET
//   PAYPAL_ENV = "sandbox" (testing) or "live" (real money)

const BASE = process.env.PAYPAL_ENV === "live"
  ? "https://api-m.paypal.com"
  : "https://api-m.sandbox.paypal.com";

const CURRENCY = "USD";
const PRICES = { spread: "1.00", outlook: "3.00" };
const SUPPORT_MIN = 1;
const SUPPORT_MAX = 100;

const CARDS = [
  ["The Fool", "a fresh start; take a leap with curiosity."],
  ["The Magician", "you have the tools; focus them on one goal."],
  ["The High Priestess", "trust your intuition and listen inward."],
  ["The Empress", "nurture what is growing around you."],
  ["The Emperor", "structure and a steady plan bring stability."],
  ["The Hierophant", "learning and guidance from a trusted source."],
  ["The Lovers", "a choice guided by your values."],
  ["The Chariot", "determination; push through small obstacles."],
  ["Strength", "patience and gentle courage win out."],
  ["The Hermit", "reflection; step back and see the bigger picture."],
  ["Wheel of Fortune", "change is coming; adapt and enjoy the ride."],
  ["Justice", "fairness and honest accounting."],
  ["The Hanged Man", "a pause that brings a new perspective."],
  ["Death", "an ending that makes room for something new."],
  ["Temperance", "balance; blend the different parts of your life."],
  ["The Devil", "notice what holds you back; awareness frees you."],
  ["The Tower", "a sudden shake-up that clears false foundations."],
  ["The Star", "hope and renewed faith; small steps are enough."],
  ["The Moon", "things may feel unclear; move carefully."],
  ["The Sun", "joy, success, and warmth."],
  ["Judgement", "reflect on what you learned and begin again."],
  ["The World", "completion; appreciate how far you have come."]
];

const YEAR_OUTLOOKS = {
  1: "This year favors bold starts. Spring is ideal for launching your next project. Summer brings recognition for work you already did. Autumn asks you to lead with patience, and winter rewards the plans you made earlier.",
  2: "This year rewards partnerships. Spring brings a meaningful connection. Summer is good for teamwork and listening well. Autumn may test your boundaries, so protect your time. Winter brings calm and a chance to heal.",
  3: "This year is a season for expression. Spring opens doors to creative work. Summer brings social energy and new friends. Autumn is ideal for finishing what you started. Winter invites quiet inspiration you can share next year.",
  4: "This year builds foundations. Spring is good for planning money and goals. Summer rewards steady effort. Autumn brings a practical challenge that you can handle well. Winter is for reviewing progress and setting the next structure.",
  5: "This year brings change and movement. Spring may bring travel or a new opportunity. Summer is full of learning. Autumn asks you to choose carefully among many options. Winter offers a chance to settle into what you value most.",
  6: "This year centers on home and care. Spring strengthens family ties. Summer is good for hosting and celebrating. Autumn may ask you to balance others' needs with your own. Winter brings warmth and gratitude.",
  7: "This year invites reflection and study. Spring is good for learning something new. Summer offers time for rest and insight. Autumn brings a clearer understanding of a long-standing question. Winter is ideal for quiet planning.",
  8: "This year favors achievement. Spring is a strong time to pursue goals. Summer may bring financial or career progress. Autumn asks you to manage responsibilities wisely. Winter rewards the effort you invested all year.",
  9: "This year is about giving and closing chapters. Spring brings chances to help others. Summer offers meaningful connections. Autumn invites you to let go of what no longer fits. Winter brings peace and a fresh start."
};

async function getAccessToken() {
  const auth = Buffer.from(
    process.env.PAYPAL_CLIENT_ID + ":" + process.env.PAYPAL_CLIENT_SECRET
  ).toString("base64");
  const res = await fetch(BASE + "/v1/oauth2/token", {
    method: "POST",
    headers: { Authorization: "Basic " + auth, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials"
  });
  if (!res.ok) throw new Error("PayPal auth failed");
  const data = await res.json();
  return data.access_token;
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  };
}

// Pick three different cards for past, present, future
function pickThree() {
  const pool = CARDS.map((_, i) => i);
  const picked = [];
  while (picked.length < 3) {
    const k = Math.floor(Math.random() * pool.length);
    picked.push(pool.splice(k, 1)[0]);
  }
  return picked.map(i => ({ name: CARDS[i][0], meaning: CARDS[i][1] }));
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch (e) { return json(400, { error: "Bad JSON" }); }

  try {
    const token = await getAccessToken();

    if (body.action === "create") {
      const product = body.product;
      let value;
      if (product === "spread" || product === "outlook") {
        value = PRICES[product];
      } else if (product === "support") {
        const n = Number(body.amount);
        if (!isFinite(n) || n < SUPPORT_MIN || n > SUPPORT_MAX) {
          return json(400, { error: "Please enter an amount between 1 and 100 USD." });
        }
        value = n.toFixed(2);
      } else {
        return json(400, { error: "Unknown product" });
      }

      const res = await fetch(BASE + "/v2/checkout/orders", {
        method: "POST",
        headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
        body: JSON.stringify({
          intent: "CAPTURE",
          purchase_units: [{
            custom_id: product,
            description: product === "support" ? "Support Daily Tarot" : "Daily Tarot " + product,
            amount: { currency_code: CURRENCY, value }
          }]
        })
      });
      const data = await res.json();
      if (!res.ok || !data.id) return json(502, { error: "Could not start payment." });
      return json(200, { id: data.id });
    }

    if (body.action === "capture" && body.orderID) {
      const res = await fetch(BASE + "/v2/checkout/orders/" + encodeURIComponent(body.orderID) + "/capture", {
        method: "POST",
        headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" }
      });
      const data = await res.json();
      const unit = data.purchase_units && data.purchase_units[0];
      const captured = unit && unit.payments && unit.payments.captures && unit.payments.captures[0];

      // Deliver only after PayPal confirms a completed payment in USD
      if (
        data.status !== "COMPLETED" ||
        !captured ||
        captured.status !== "COMPLETED" ||
        captured.amount.currency_code !== CURRENCY
      ) {
        return json(402, { error: "Payment not completed" });
      }

      const paid = captured.amount.value;
      const product = body.product;

      if (product === "spread") {
        if (paid !== PRICES.spread) return json(402, { error: "Amount mismatch" });
        return json(200, { type: "spread", cards: pickThree() });
      }

      if (product === "outlook") {
        if (paid !== PRICES.outlook) return json(402, { error: "Amount mismatch" });
        const life = Number(body.lifePath);
        return json(200, {
          type: "outlook",
          year: new Date().getFullYear(),
          outlook: YEAR_OUTLOOKS[life] || YEAR_OUTLOOKS[9]
        });
      }

      if (product === "support") {
        if (Number(paid) < SUPPORT_MIN) return json(402, { error: "Amount mismatch" });
        return json(200, { type: "support" });
      }

      return json(400, { error: "Unknown product" });
    }

    return json(400, { error: "Unknown action" });
  } catch (err) {
    return json(500, { error: "Server error" });
  }
};

