// server.js
require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');
const twilio = require('twilio');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors()); // allow CORS; adjust origin in production

const ORDERS_FILE = path.join(__dirname, 'orders.json');

// helper to append order
function saveOrder(order){
  let arr = [];
  try{ arr = JSON.parse(fs.readFileSync(ORDERS_FILE)); }catch(e){ arr = []; }
  arr.unshift(order);
  fs.writeFileSync(ORDERS_FILE, JSON.stringify(arr, null, 2));
}

// setup nodemailer transporter (SMTP)
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST, // e.g., smtp.sendgrid.net or smtp.gmail.com
  port: Number(process.env.SMTP_PORT || 587),
  secure: process.env.SMTP_PORT === '465', // true for 465, false for others
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

// setup Twilio if credentials provided
let twClient = null;
if(process.env.TWILIO_SID && process.env.TWILIO_TOKEN){
  twClient = twilio(process.env.TWILIO_SID, process.env.TWILIO_TOKEN);
}

function buildOrderText(order){
  let txt = Order ID: ${order.id}\nCustomer: ${order.name}\nPhone: ${order.phone}\nEmail: ${order.email}\nAddress: ${order.address}\nPickup: ${order.pickup}\nNotes: ${order.notes}\n\nItems:\n;
  order.items.forEach(it => { txt += ` - ${it.name}: ${it.qty} × PKR ${it.price} = PKR ${it.qty*it.price}\n`; });
  txt += \nSubtotal: PKR ${order.subtotal}\nPickup: PKR ${order.pickupCharge}\nTotal: PKR ${order.total}\n;
  return txt;
}

app.post('/api/order', async (req, res) => {
  try{
    const order = req.body;
    if(!order || !order.items || !order.email || !order.phone) return res.status(400).json({ error: 'Invalid order payload' });

    // add timestamp if missing
    order.created = order.created || new Date().toISOString();

    // save to file
    saveOrder(order);

    // notification text
    const orderText = buildOrderText(order);

    // Send email to customer
    const mailOptionsCustomer = {
      from: process.env.FROM_EMAIL, // verified sender
      to: order.email,
      subject: FreshFold Laundry — Order Confirmation (${order.id}),
      text: Hello ${order.name},\n\nThank you for your order. Details below:\n\n${orderText}\n\nRegards,\nFreshFold Laundry
    };
    await transporter.sendMail(mailOptionsCustomer);

    // Send email to owner
    if(process.env.OWNER_EMAIL){
      const mailOwner = {
        from: process.env.FROM_EMAIL,
        to: process.env.OWNER_EMAIL,
        subject: New Order Received — ${order.id},
        text: New order received:\n\n${orderText}
      };
      await transporter.sendMail(mailOwner);
    }

    // Send SMS (Twilio) to customer & owner if Twilio configured
    if(twClient && process.env.TWILIO_FROM){
      const smsBody = FreshFold: New order ${order.id}. ${order.totalItems} items. Total PKR ${order.total}. Pickup: ${order.pickup}. Customer: ${order.name} ${order.phone};
      // to customer
      try{
        await twClient.messages.create({ body: Thank you ${order.name}! Your order ${order.id} was received. Total PKR ${order.total}., from: process.env.TWILIO_FROM, to: order.phone });
      }catch(sme){ console.error('SMS to customer failed', sme.message); }
      // to owner
      if(process.env.OWNER_PHONE){
        try{
          await twClient.messages.create({ body: New order ${order.id}: ${order.totalItems} items, Total PKR ${order.total}. Pickup: ${order.pickup}, from: process.env.TWILIO_FROM, to: process.env.OWNER_PHONE });
        }catch(sme){ console.error('SMS to owner failed', sme.message); }
      }
    }

    return res.json({ ok:true, orderId: order.id });
  }catch(err){
    console.error('Order API error:', err);
    return res.status(500).json({ error: 'Failed to process order' });
  }
});

// static front-end (optional)
if(process.env.SERVE_STATIC === 'true'){
  app.use(express.static(path.join(__dirname, 'public'))); // put index.html in public/
  app.get('*', (req,res)=> res.sendFile(path.join(__dirname,'public','index.html')));
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, ()=> console.log(Server listening on ${PORT}));