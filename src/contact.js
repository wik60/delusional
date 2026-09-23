import "./contact.css";
import { supabase } from "./supabase.js";

const form = document.querySelector("#contactForm");
const status = document.querySelector("#contactStatus");

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!form.reportValidity()) return;
  if (document.querySelector("#contactCompany").value) return;

  const button = form.querySelector("button");
  button.disabled = true;
  button.textContent = "SENDING…";
  status.textContent = "";

  const { error } = await supabase.from("contact_messages").insert({
    name: document.querySelector("#contactName").value.trim(),
    email: document.querySelector("#contactEmail").value.trim().toLowerCase(),
    subject: document.querySelector("#contactSubject").value.trim(),
    message: document.querySelector("#contactMessage").value.trim(),
  });

  if (error) {
    console.error(error);
    status.textContent = "COULDN'T SEND YOUR MESSAGE. PLEASE TRY AGAIN.";
  } else {
    form.reset();
    status.textContent = "MESSAGE SENT. WE'LL REPLY TO THE E-MAIL ADDRESS YOU PROVIDED.";
  }

  button.disabled = false;
  button.textContent = "SEND MESSAGE →";
});
