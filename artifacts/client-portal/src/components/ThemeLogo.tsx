import logoLight from "@assets/ThriveSolo_Main_1777750309794.png";
import logoDark from "@assets/ThriveSolo_Square_white_letters_1777750309795.png";
import { useTheme } from "@/components/ThemeProvider";

export const themeLogoSources = {
  light: logoLight,
  dark: logoDark,
} as const;

export function ThemeLogo({
  className,
  alt = "ThriveSolo",
}: {
  className?: string;
  alt?: string;
}) {
  const { theme } = useTheme();
  return (
    <img
      src={theme === "dark" ? logoDark : logoLight}
      alt={alt}
      className={className}
    />
  );
}
