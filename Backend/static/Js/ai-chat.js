(function () {
  const chatToggleButton = document.getElementById("ai-chat-toggle");
  const chatPanel = document.getElementById("ai-chat-panel");
  const messageList = document.getElementById("ai-chat-messages");
  const form = document.getElementById("ai-chat-form");
  const input = document.getElementById("ai-chat-input");
  const status = document.getElementById("ai-chat-status");

  if (!chatToggleButton || !chatPanel || !messageList || !form || !input) {
    return;
  }

  let isOpen = false;
  let isSending = false;

  const createMessageBubble = (content, sender) => {
    const bubble = document.createElement("div");
    bubble.classList.add("ai-chat__message", `ai-chat__message--${sender}`);
    bubble.innerHTML = content;
    messageList.appendChild(bubble);
    messageList.scrollTop = messageList.scrollHeight;
  };

  const setLoading = (loading) => {
    isSending = loading;
    input.disabled = loading;
    if (loading) {
      status.textContent = "Thinking...";
      status.classList.add("is-visible");
    } else {
      status.textContent = "";
      status.classList.remove("is-visible");
    }
  };

  const sendMessage = async (text) => {
    const trimmed = text.trim();
    if (!trimmed || isSending) {
      return;
    }

    createMessageBubble(`<span>${trimmed}</span>`, "user");
    input.value = "";
    setLoading(true);

    try {
      const response = await fetch("/api/ai-chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ message: trimmed }),
      });

      if (!response.ok) {
        throw new Error("Network response was not ok");
      }

      const data = await response.json();
      const aiMessage = (data && data.response) ||
        "I’m sorry, I couldn’t load that insight just now. Please try again.";

      createMessageBubble(`<span>${aiMessage}</span>`, "ai");
    } catch (error) {
      console.error("AI chat request failed", error);
      createMessageBubble(
        "<span>Something went wrong while contacting the assistant. You can refresh the page or head to the contact form.</span>",
        "ai"
      );
    } finally {
      setLoading(false);
    }
  };

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    sendMessage(input.value);
  });

  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      form.requestSubmit();
    }
  });

  chatToggleButton.addEventListener("click", () => {
    isOpen = !isOpen;
    chatPanel.classList.toggle("is-open", isOpen);
    chatToggleButton.setAttribute("aria-expanded", String(isOpen));

    if (isOpen && messageList.childElementCount === 0) {
      createMessageBubble(
        "<span>Hi there! I’m your analytics co-pilot. Ask about dashboards, insights, or getting support and I’ll point you in the right direction.</span>",
        "ai"
      );
      input.focus();
    }
  });

  // Allow ESC to close the chat panel for accessibility.
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && isOpen) {
      chatPanel.classList.remove("is-open");
      chatToggleButton.setAttribute("aria-expanded", "false");
      isOpen = false;
    }
  });
})();
