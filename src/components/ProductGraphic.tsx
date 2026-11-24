import React, { useEffect, useState } from 'react';
import { Package } from 'lucide-react';
import { Product } from '../types/pos';

interface ProductGraphicProps {
  product: Product;
  className?: string;
}

export const ProductGraphic: React.FC<ProductGraphicProps> = ({
  product,
  className = 'w-full h-full',
}) => {
  const cleanImageUrl =
    typeof product.imageUrl === 'string' ? product.imageUrl.trim() : '';
  const [imageError, setImageError] = useState(false);

  // Reset imageError whenever the product ID or its image URL changes
  useEffect(() => {
    setImageError(false);
  }, [product.id, cleanImageUrl]);

  if (cleanImageUrl && !imageError) {
    return (
      <img
        key={`${product.id}:${cleanImageUrl.slice(0, 64)}`}
        src={cleanImageUrl}
        alt={product.name}
        className={`${className} object-contain`}
        onError={() => setImageError(true)}
        loading="lazy"
      />
    );
  }

  // Clean neutral placeholder when no uploaded photo exists
  return (
    <div
      className={`${className} flex flex-col items-center justify-center bg-slate-50 border border-slate-200/80 text-slate-400 rounded-xl p-2`}
      aria-label={`${product.name} placeholder`}
    >
      <Package className="w-7 h-7 text-slate-300" />
    </div>
  );
};

