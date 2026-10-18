// Netlify Function: handles PayPal orders for the "Full year outlook" ($3) extra.
// Environment variables (set in Netlify dashboard, never in the HTML):
//   PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET
//   PAYPAL_ENV = "sandbox" (testing) or "live" (real money)

const BASE = process.env.PAYPAL_ENV === "live"
  ? "https://api-m.paypal.com"
  : "https://api-m.sandbox.paypal.com";

const PRICE = "3.00";
const CURRENCY = "USD";

// Outlook text is only sent back AFTER a verified payment, keyed by life path number
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

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch (e) { return json(400, { error: "Bad JSON" }); }

  try {
    const token = await getAccessToken();

    if (body.action === "create") {
      const res = await fetch(BASE + "/v2/checkout/orders", {
        method: "POST",
        headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
        body: JSON.stringify({
          intent: "CAPTURE",
          purchase_units: [{
            description: "Full year outlook",
            amount: { currency_code: CURRENCY, value: PRICE }
          }]
        })
      });
      const data = await res.json();
      return json(res.status, { id: data.id });
    }

    if (body.action === "capture" && body.orderID) {
      const res = await fetch(BASE + "/v2/checkout/orders/" + encodeURIComponent(body.orderID) + "/capture", {
        method: "POST",
        headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" }
      });
      const data = await res.json();
      const unit = data.purchase_units && data.purchase_units[0];
      const captured = unit && unit.payments && unit.payments.captures && unit.payments.captures[0];

      // Only deliver after PayPal confirms completed payment of the exact price
      if (
        data.status !== "COMPLETED" ||
        !captured ||
        captured.status !== "COMPLETED" ||
        captured.amount.value !== PRICE ||
        captured.amount.currency_code !== CURRENCY
      ) {
        return json(402, { error: "Payment not completed" });
      }

      const life = Number(body.lifePath);
      const outlook = YEAR_OUTLOOKS[life] || YEAR_OUTLOOKS[9];
      return json(200, { outlook, year: new Date().getFullYear() });
    }

    return json(400, { error: "Unknown action" });
  } catch (err) {
    return json(500, { error: "Server error" });
  }
};
