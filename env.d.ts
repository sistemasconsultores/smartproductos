/// <reference types="@remix-run/node" />
/// <reference types="vite/client" />

// Shopify App Bridge web components
declare namespace React.JSX {
  interface IntrinsicElements {
    "ui-nav-menu": React.DetailedHTMLProps<
      React.HTMLAttributes<HTMLElement>,
      HTMLElement
    >;
  }
}
