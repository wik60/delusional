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
  button.textContent = "WYSYŁANIE…";
  status.textContent = "";

  const { error } = await supabase.from("contact_messages").insert({
    name: document.querySelector("#contactName").value.trim(),
    email: document.querySelector("#contactEmail").value.trim().toLowerCase(),
    subject: document.querySelector("#contactSubject").value.trim(),
    message: document.querySelector("#contactMessage").value.trim(),
  });

  if (error) {
    console.error(error);
    status.textContent = "NIE UDAŁO SIĘ WYSŁAĆ WIADOMOŚCI. SPRÓBUJ PONOWNIE.";
  } else {
    form.reset();
    status.textContent = "WIADOMOŚĆ ZOSTAŁA WYSŁANA. ODPOWIEMY NA PODANY E-MAIL.";
  }

  button.disabled = false;
  button.textContent = "WYŚLIJ WIADOMOŚĆ →";
});
