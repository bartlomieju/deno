import "npm:express";

setTimeout(callback, 1000);

function callback() {
  try {
    throw new Error("boom");
  } catch (e) {
    console.log("caught", e);
  }
}
