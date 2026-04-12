class Chart {
  constructor() {}
  update() {}
  destroy() {}
  resetZoom() {}
}
Chart.pluginService = { register() {} };
Chart.Tooltip = { positioners: {} };
Chart.helpers = {
  merge: function (target, ...sources) {
    return Object.assign({}, target, ...sources);
  },
};
Chart.defaults = { global: {} };

module.exports = Chart;
module.exports.__esModule = true;
module.exports.default = Chart;
module.exports.Chart = Chart;
