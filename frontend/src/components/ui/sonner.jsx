import { Toaster as Sonner } from "sonner";

const Toaster = ({ ...props }) => (
  <Sonner
    theme="light"
    className="toaster group"
    style={{
      "--normal-bg": "var(--popover)",
      "--normal-text": "var(--popover-foreground)",
      "--normal-border": "var(--border)",
      "--border-radius": "var(--radius)",
    }}
    {...props}
  />
);

export { Toaster };
