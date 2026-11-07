import { SITE_NAME, siteDescription, siteUrl } from "@/lib/site";
import { faqs } from "./closing";

const url = new URL("/", siteUrl).toString();

const graph = [
  {
    "@type": "SoftwareApplication",
    name: SITE_NAME,
    url,
    description: siteDescription,
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  },
  { "@type": "WebSite", name: SITE_NAME, url },
  {
    "@type": "FAQPage",
    mainEntity: faqs.map((faq) => ({
      "@type": "Question",
      name: faq.q,
      acceptedAnswer: { "@type": "Answer", text: faq.a },
    })),
  },
];

// Escaping "<" keeps any text in the data from closing the script tag.
const json = JSON.stringify({ "@context": "https://schema.org", "@graph": graph }).replace(
  /</g,
  "\\u003c",
);

export function JsonLd() {
  return <script dangerouslySetInnerHTML={{ __html: json }} type="application/ld+json" />;
}
