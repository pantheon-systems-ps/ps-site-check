import { type RouteConfig, route, index } from "@react-router/dev/routes";

export default [
  index("./routes/_index.tsx"),
  route("batch", "./routes/batch.tsx"),
  route("compare", "./routes/compare.tsx"),
  route("migration", "./routes/migration.tsx"),
] satisfies RouteConfig;
