import { build } from './build';
import { rotation } from './rotation';
import { banner } from './banner';
import { news } from './news';
import { weaponGuide } from './weaponGuide';
import { endgameGuide } from './endgameGuide';
import {
  source, team, externalLink, video, localeString,
  weaponChoice, artifactChoice, mainStats, rotationCast, rotationHalf,
  rotationFloor, rotationChamber, rotationEnemyHalf, rotationStage,
  featuredCharacter,
} from './objects';
import { guideSubmission, feedback } from './moderation';

export const schemaTypes = [
  source, team, externalLink, video, localeString,
  weaponChoice, artifactChoice, mainStats, rotationCast, rotationHalf,
  rotationFloor, rotationChamber, rotationEnemyHalf, rotationStage,
  featuredCharacter,
  build, rotation, banner, news, weaponGuide, endgameGuide,
  guideSubmission, feedback,
];
