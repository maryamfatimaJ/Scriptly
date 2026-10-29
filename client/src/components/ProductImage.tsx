import { useState } from "react";
import { catalogueImageUrl } from "@/api/medicines";
import type { CatalogueImage } from "@/types";

// A medicine's product photo — or an honest placeholder.
//
// Only photos verified as THIS exact product (brand, strength, form) ever
// reach here; see server/scripts/importImages.ts. There is deliberately no
// generic pill or capsule picture: a stock image beside a product name
// reads as "this is what it looks like", which would be untrue.

const KIND_LABEL: Record<CatalogueImage["kind"], string> = {
  PACK_BOX: "Pack",
  BLISTER: "Blister strip",
  BOTTLE: "Bottle",
  CONTAINER: "Container",
  FORMULATION: "The medicine itself",
  OTHER: "Product photo",
};

export function ProductImagePlaceholder({ size = "large" }: { size?: "small" | "large" }) {
  return (
    <div
      className={`flex items-center justify-center rounded-2xl border border-dashed border-charcoal/25 bg-offwhite text-center text-gray ${
        size === "small" ? "h-16 w-16 text-[10px] leading-tight" : "aspect-[4/3] w-full p-6 text-sm"
      }`}
      role="img"
      aria-label="Product image unavailable"
    >
      {size === "small" ? "No image" : "Product image unavailable — Scriptly has no verified photo of this exact product."}
    </div>
  );
}

export function ProductThumbnail({ image, alt }: { image: CatalogueImage | null | undefined; alt: string }) {
  const [failed, setFailed] = useState(false);
  if (!image || failed) return <ProductImagePlaceholder size="small" />;
  return (
    <img
      src={catalogueImageUrl(image.url)}
      alt={alt}
      loading="lazy"
      onError={() => setFailed(true)}
      className="h-16 w-16 rounded-2xl border border-charcoal/10 bg-white object-contain"
    />
  );
}

export function ProductGallery({ images, name }: { images: CatalogueImage[]; name: string }) {
  const [index, setIndex] = useState(0);
  const [failed, setFailed] = useState<Record<string, boolean>>({});
  const image = images[index];
  if (!image || failed[image.id]) return <ProductImagePlaceholder />;

  return (
    <figure>
      <img
        src={catalogueImageUrl(image.url)}
        alt={`${name} — ${KIND_LABEL[image.kind].toLowerCase()}`}
        width={image.width}
        height={image.height}
        onError={() => setFailed((f) => ({ ...f, [image.id]: true }))}
        className="aspect-[4/3] w-full rounded-2xl border border-charcoal/10 bg-white object-contain"
      />
      {images.length > 1 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {images.map((img, i) => (
            <button
              key={img.id}
              type="button"
              onClick={() => setIndex(i)}
              aria-pressed={i === index}
              className={`rounded-capsule border px-3 py-1 text-xs ${
                i === index ? "border-forest bg-mint/40 text-charcoal" : "border-charcoal/20 text-charcoal/70 hover:border-forest"
              }`}
            >
              {KIND_LABEL[img.kind]}
            </button>
          ))}
        </div>
      )}
      <figcaption className="mt-2 text-xs text-gray">
        {KIND_LABEL[image.kind]} · {image.attribution} · {image.licence}
        {image.sourceUrl && (
          <>
            {" · "}
            <a href={image.sourceUrl} target="_blank" rel="noreferrer" className="underline underline-offset-2">
              source
            </a>
          </>
        )}
        {" · "}checked {new Date(image.verifiedAt).toLocaleDateString()}
      </figcaption>
    </figure>
  );
}
