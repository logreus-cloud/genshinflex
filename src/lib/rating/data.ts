// Рейтинг для страниц: модуль вычисляется один раз за сборку, а не на каждую страницу персонажа
import rating from '../../data/rating.json';
import manual from '../../data/rating-manual.json';
import external from '../../data/rating-external.json';
import { buildOverall, type RatingData, type RatingExternal, type RatingManual } from './core';

export const ratingData = rating as RatingData;
export const ratingManual = manual as RatingManual;
export const ratingExternal = external as RatingExternal;
export const overall = buildOverall(ratingData, ratingManual, ratingExternal);
