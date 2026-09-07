// Race variant background: create the offscreen document and record the attempt.
let sendAttempt = null;
chrome.runtime.onMessage.addListener((m) => { if (m && m.type === "b02-race-sent") sendAttempt = m; });

globalThis.__b02_race = async function () {
  const has = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] });
  if (!has.length) {
    await chrome.offscreen.createDocument({
      url: "offscreen.html", reasons: ["WORKERS"], justification: "B-02 race probe"
    });
  }
  // give the immediate send time to complete or fail
  for (let i = 0; i < 40 && sendAttempt === null; i++) await new Promise((r) => setTimeout(r, 100));
  return { senderAttempted: sendAttempt !== null, sendAttempt };
};
