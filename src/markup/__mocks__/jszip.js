module.exports = class JSZip {
  constructor() {}
  folder() {
    return this;
  }
  file() {
    return this;
  }
  generateAsync() {
    return Promise.resolve(new Blob());
  }
};
