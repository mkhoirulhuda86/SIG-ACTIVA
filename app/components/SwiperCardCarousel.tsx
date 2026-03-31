'use client';

import { ReactNode } from 'react';
import { Swiper, SwiperSlide } from 'swiper/react';
import { Pagination } from 'swiper/modules';

import 'swiper/css';
import 'swiper/css/pagination';

type SwiperCardCarouselProps = {
  items: ReactNode[];
  breakpoints: Record<number, { slidesPerView: number; spaceBetween?: number }>;
  className?: string;
  slideClassName?: string;
  showPagination?: boolean;
};

export default function SwiperCardCarousel({
  items,
  breakpoints,
  className,
  slideClassName,
  showPagination = true,
}: SwiperCardCarouselProps) {
  return (
    <div className={className}>
      <Swiper
        modules={[Pagination]}
        grabCursor
        slidesPerView={1}
        spaceBetween={12}
        pagination={
          showPagination
            ? {
                clickable: true,
                dynamicBullets: true,
              }
            : false
        }
        breakpoints={breakpoints}
      >
        {items.map((item, idx) => (
          <SwiperSlide key={idx} className={slideClassName}>
            <div className="h-full w-full">{item}</div>
          </SwiperSlide>
        ))}
      </Swiper>
    </div>
  );
}

