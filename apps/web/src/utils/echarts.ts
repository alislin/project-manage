/**
 * ECharts 按需引入（06-web §7 / plan §2 控制包体积）：
 * - 仅注册 S8 四图所需 chart（Pie/Funnel/Line/Bar）与 component（Tooltip/Legend/Grid）+ CanvasRenderer；
 * - 全站统一经此模块获取 echarts 工厂，禁止整包 `import * as echarts from "echarts"`；
 * - vite.config.ts 将 echarts/zrender 单独分包，体积变化可在构建产物中直接观察。
 */
import * as echarts from "echarts/core";
import { BarChart, FunnelChart, LineChart, PieChart } from "echarts/charts";
import { GridComponent, LegendComponent, TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";

echarts.use([
  PieChart,
  FunnelChart,
  LineChart,
  BarChart,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  CanvasRenderer,
]);

export { echarts };
