import "styled-components/native";
import type { AppTheme } from "../theme/Theme";

declare module "styled-components/native" {
  export interface DefaultTheme extends AppTheme {}
}
