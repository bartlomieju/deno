setTimeout(callback, 1000);

function callback() {
  try {
    Deno.lstatSync("foo");
    return true;
  } catch (e) {
    console.log("caught", e);
    return false;
  }
}
