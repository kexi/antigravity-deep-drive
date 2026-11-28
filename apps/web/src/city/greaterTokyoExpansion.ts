import * as THREE from "three";
import type RAPIER from "@dimforge/rapier3d-compat";
import {
  WORLD_CHUNK_DEFINITIONS,
  type WorldChunkDefinition,
  type WorldChunkId,
} from "./openWorldStreaming";
import { shibuyaTextureManager } from "../textures/shibuyaTextureManager";

/**
 * 大東京 10倍拡張オープンワールドの全体空間境界 (東西 10.0 km × 南北 8.6 km = 86.0 km²)
 * 従来の20チャンク領域 (3.0 km × 2.6 km = 7.8 km²) と比較して面積比 11.03 倍。
 */
export const GREATER_TOKYO_WORLD_BOUNDS = {
  minX: -5600,
  maxX: 4400,
  minZ: -4200,
  maxZ: 4400,
  widthMeters: 10000,
  depthMeters: 8600,
  areaSqKm: 86.0,
} as const;

export interface GreaterTokyoRoadSegmentSpec {
  readonly id: string;
  readonly displayName: string;
  readonly routeCode: string;
  readonly widthMeters: number;
  readonly sidewalkWidthMeters: number;
  readonly lanesPerDirection: number;
  readonly hasYellowCenterLine: boolean;
  readonly isBridge?: boolean;
  readonly points: ReadonlyArray<{ readonly x: number; readonly z: number }>;
}

export interface GreaterTokyoIntersectionSpec {
  readonly id: string;
  readonly nameJa: string;
  readonly nameEn: string;
  readonly x: number;
  readonly z: number;
  readonly width: number;
  readonly depth: number;
}

export interface GreaterTokyoLandmarkSpec {
  readonly id: string;
  readonly nameJa: string;
  readonly nameEn: string;
  readonly usage: string;
  readonly chunkId: WorldChunkId;
  readonly x: number;
  readonly z: number;
  readonly width: number;
  readonly depth: number;
  readonly height: number;
  readonly storeys: number;
  readonly style:
    | "tocho"
    | "tokyo_tower"
    | "skytree"
    | "rainbow_bridge"
    | "carrot_tower"
    | "tokyo_dome"
    | "fuji_tv";
}

interface OuterBuildingBox {
  readonly x: number;
  readonly z: number;
  readonly w: number;
  readonly d: number;
  readonly h: number;
  readonly yaw: number;
  readonly style: "glass" | "commercial" | "alley";
  readonly tint: number;
}

export interface GreaterTokyoEmissiveEntry {
  material: THREE.MeshStandardMaterial;
  dayIntensity: number;
  nightIntensity: number;
}

export interface GreaterTokyoExpansionBundle {
  readonly rootGroup: THREE.Group;
  readonly roadNetworkGroup: THREE.Group;
  readonly landmarksGroup: THREE.Group;
  readonly waterGroup: THREE.Group;
  readonly outerChunkGroups: Map<WorldChunkId, THREE.Group>;
  readonly emissiveEntries: GreaterTokyoEmissiveEntry[];
  readonly totalRoadLengthKm: number;
  readonly totalOuterBuildingCount: number;
  readonly activateOuterChunkColliders: (chunkId: WorldChunkId) => RAPIER.Collider[];
  readonly deactivateOuterChunkColliders: (chunkId: WorldChunkId) => RAPIER.Collider[];
}

/**
 * 既存コア20チャンクの外側を隙間なく結ぶ大東京広域幹線道路網（総延長 > 125 km）。
 * 全11箇所の既存道路外端（玉川通りR246、山手通り北/南、明治通り原宿/恵比寿、外苑東通り、
 * 日比谷通り南、昭和通り北/南、晴海通り東、永代通り東）から途切れなくシームレス延伸する。
 */
export const GREATER_TOKYO_ARTERIAL_ROADS: ReadonlyArray<GreaterTokyoRoadSegmentSpec> = [
  // === 1. 西方延伸（三軒茶屋・世田谷・駒沢・下北沢・初台・笹塚・中野） ===
  {
    id: "gt-road-tamagawa-r246-west",
    displayName: "玉川通り・国道246号（池尻大橋〜三軒茶屋〜駒沢〜用賀方面）",
    routeCode: "国道246号",
    widthMeters: 22.0,
    sidewalkWidthMeters: 4.5,
    lanesPerDirection: 3,
    hasYellowCenterLine: true,
    points: [
      { x: -1625, z: 740 },
      { x: -1950, z: 805 },
      { x: -2500, z: 910 },
      { x: -3100, z: 1020 },
      { x: -3850, z: 1140 },
      { x: -4600, z: 1260 },
      { x: -5400, z: 1380 },
    ],
  },
  {
    id: "gt-road-koshu-kaido-west",
    displayName: "甲州街道・国道20号（初台〜笹塚〜下北沢北〜明大前）",
    routeCode: "国道20号",
    widthMeters: 22.0,
    sidewalkWidthMeters: 4.5,
    lanesPerDirection: 3,
    hasYellowCenterLine: true,
    points: [
      { x: -1640, z: -350 },
      { x: -1950, z: -350 },
      { x: -3100, z: -350 },
      { x: -4600, z: -350 },
      { x: -5400, z: -350 },
    ],
  },
  // === 2. 東方延伸（築地・勝鬨橋・晴海・豊洲・永代橋・門前仲町・木場） ===
  {
    id: "gt-road-harumi-dori-east",
    displayName: "晴海通り（築地〜勝鬨橋〜晴海〜豊洲市場）",
    routeCode: "東京都道304号",
    widthMeters: 22.0,
    sidewalkWidthMeters: 4.5,
    lanesPerDirection: 3,
    hasYellowCenterLine: false,
    isBridge: true,
    points: [
      { x: 800, z: -350 },
      { x: 1400, z: -350 },
      { x: 2100, z: -350 },
      { x: 2850, z: -350 },
      { x: 3600, z: -350 },
      { x: 4250, z: -350 },
    ],
  },
  {
    id: "gt-road-eitai-dori-east",
    displayName: "永代通り（永代橋〜門前仲町〜木場〜東陽町）",
    routeCode: "東京都道10号",
    widthMeters: 22.0,
    sidewalkWidthMeters: 4.5,
    lanesPerDirection: 3,
    hasYellowCenterLine: false,
    isBridge: true,
    points: [
      { x: 650, z: 250 },
      { x: 1400, z: 250 },
      { x: 2100, z: 250 },
      { x: 2850, z: 250 },
      { x: 3600, z: 250 },
      { x: 4250, z: 250 },
    ],
  },
  // === 3. 南北縦断メガ延伸（山手通り・明治通り・外苑東通り・日比谷通り・昭和通り） ===
  {
    id: "gt-road-yamate-north",
    displayName: "山手通り北進（初台〜西新宿〜中野坂上・中井方面）",
    routeCode: "都道317号",
    widthMeters: 24.0,
    sidewalkWidthMeters: 4.5,
    lanesPerDirection: 3,
    hasYellowCenterLine: false,
    points: [
      { x: -1640, z: -350 },
      { x: -1640, z: -1100 },
      { x: -1640, z: -1850 },
      { x: -1640, z: -2650 },
      { x: -1640, z: -3400 },
    ],
  },
  {
    id: "gt-road-yamate-south",
    displayName: "山手通り南進（中目黒〜目黒〜五反田〜大崎）",
    routeCode: "都道317号",
    widthMeters: 24.0,
    sidewalkWidthMeters: 4.5,
    lanesPerDirection: 3,
    hasYellowCenterLine: false,
    points: [
      { x: -1620, z: 1050 },
      { x: -1620, z: 1600 },
      { x: -1620, z: 2150 },
      { x: -1620, z: 2900 },
      { x: -1620, z: 3650 },
    ],
  },
  {
    id: "gt-road-meiji-shinjuku-north",
    displayName: "明治通り北進（原宿〜代々木〜新宿三丁目〜歌舞伎町）",
    routeCode: "東京都道305号",
    widthMeters: 20.0,
    sidewalkWidthMeters: 4.0,
    lanesPerDirection: 3,
    hasYellowCenterLine: false,
    points: [
      { x: -731.9, z: -422.8 },
      { x: -780, z: -860 },
      { x: -850, z: -1350 },
      { x: -920, z: -1850 },
      { x: -920, z: -2650 },
      { x: -920, z: -3400 },
    ],
  },
  {
    id: "gt-road-meiji-hiroo-south",
    displayName: "明治通り・外苑東連絡（恵比寿〜広尾〜麻布十番〜後楽園）",
    routeCode: "東京都道305号",
    widthMeters: 20.0,
    sidewalkWidthMeters: 4.0,
    lanesPerDirection: 3,
    hasYellowCenterLine: false,
    points: [
      { x: -390, z: 1120 },
      { x: -390, z: 1650 },
      { x: -390, z: 2150 },
      { x: -390, z: 2900 },
      { x: -390, z: 3650 },
    ],
  },
  {
    id: "gt-road-gaien-higashi-north",
    displayName: "外苑東通り北進（信濃町〜四ツ谷〜市ヶ谷〜神楽坂）",
    routeCode: "東京都道319号",
    widthMeters: 18.0,
    sidewalkWidthMeters: 4.0,
    lanesPerDirection: 2,
    hasYellowCenterLine: false,
    points: [
      { x: -380, z: -350 },
      { x: -380, z: -1100 },
      { x: -380, z: -1850 },
      { x: -380, z: -2650 },
      { x: -380, z: -3400 },
    ],
  },
  {
    id: "gt-road-hibiya-shinagawa-south",
    displayName: "日比谷通り・三田通り（新橋〜田町〜高輪〜品川）",
    routeCode: "東京都道409号",
    widthMeters: 20.0,
    sidewalkWidthMeters: 4.0,
    lanesPerDirection: 3,
    hasYellowCenterLine: false,
    points: [
      { x: 0, z: -1050 },
      { x: 0, z: -1850 },
      { x: 0, z: -2650 },
      { x: 0, z: -3400 },
    ],
  },
  {
    id: "gt-road-daiichi-keihin-south",
    displayName: "第一京浜・国道15号（汐留〜田町〜品川駅前〜天王洲）",
    routeCode: "国道15号",
    widthMeters: 24.0,
    sidewalkWidthMeters: 4.5,
    lanesPerDirection: 3,
    hasYellowCenterLine: false,
    points: [
      { x: 650, z: -750 },
      { x: 650, z: -1300 },
      { x: 650, z: -1850 },
      { x: 650, z: -2650 },
      { x: 650, z: -3400 },
    ],
  },
  {
    id: "gt-road-showa-ueno-asakusa",
    displayName: "昭和通り・江戸通り北進（秋葉原〜御徒町〜上野〜浅草）",
    routeCode: "国道4号",
    widthMeters: 24.0,
    sidewalkWidthMeters: 4.5,
    lanesPerDirection: 3,
    hasYellowCenterLine: false,
    points: [
      { x: 650, z: 850 },
      { x: 650, z: 1500 },
      { x: 650, z: 2150 },
      { x: 650, z: 2900 },
      { x: 650, z: 3650 },
    ],
  },
  // === 4. 大東京 外周南北環状線（環七通り・茶沢中野通り・清澄通り・お台場通り・三ツ目通り） ===
  {
    id: "gt-road-kannana-ring7",
    displayName: "環状七号線・環七通り（方南町〜下北沢〜世田谷〜駒沢〜自由が丘）",
    routeCode: "東京都道318号",
    widthMeters: 24.0,
    sidewalkWidthMeters: 4.5,
    lanesPerDirection: 3,
    hasYellowCenterLine: false,
    points: [
      { x: -4600, z: -3400 },
      { x: -4600, z: -1850 },
      { x: -4600, z: -350 },
      { x: -4600, z: 1260 },
      { x: -4600, z: 2150 },
      { x: -4600, z: 3650 },
    ],
  },
  {
    id: "gt-road-chazawa-nakano-arterial",
    displayName: "中野通り・茶沢通り（中野坂上〜西新宿〜笹塚〜三軒茶屋〜学芸大学）",
    routeCode: "東京都道420号",
    widthMeters: 20.0,
    sidewalkWidthMeters: 4.0,
    lanesPerDirection: 2,
    hasYellowCenterLine: true,
    points: [
      { x: -3100, z: -3400 },
      { x: -3100, z: -1850 },
      { x: -3100, z: -350 },
      { x: -3100, z: 1020 },
      { x: -3100, z: 2150 },
      { x: -3100, z: 3650 },
    ],
  },
  {
    id: "gt-road-kiyosumi-sumida-east",
    displayName: "清澄通り（勝どき〜門前仲町〜清澄白河〜両国〜隅田川東岸）",
    routeCode: "東京都道463号",
    widthMeters: 20.0,
    sidewalkWidthMeters: 4.0,
    lanesPerDirection: 2,
    hasYellowCenterLine: false,
    points: [
      { x: 2100, z: -1150 },
      { x: 2100, z: -350 },
      { x: 2100, z: 250 },
      { x: 2100, z: 1200 },
      { x: 2100, z: 2150 },
      { x: 2100, z: 3650 },
    ],
  },
  {
    id: "gt-road-odaiba-boulevard",
    displayName: "お台場臨海大通り（お台場海浜公園〜フジテレビ〜晴海連絡）",
    routeCode: "臨海副都心幹線",
    widthMeters: 22.0,
    sidewalkWidthMeters: 4.5,
    lanesPerDirection: 3,
    hasYellowCenterLine: false,
    points: [
      { x: 2650, z: -3400 },
      { x: 2650, z: -1850 },
      { x: 2650, z: -1150 },
      { x: 2100, z: -1150 },
    ],
  },
  {
    id: "gt-road-mitsume-skytree-corridor",
    displayName: "三ツ目通り・湾岸連絡（有明〜豊洲〜木場〜錦糸町〜東京スカイツリー）",
    routeCode: "東京都道319号",
    widthMeters: 22.0,
    sidewalkWidthMeters: 4.5,
    lanesPerDirection: 3,
    hasYellowCenterLine: false,
    points: [
      { x: 3600, z: -3400 },
      { x: 3600, z: -1850 },
      { x: 3600, z: -350 },
      { x: 3600, z: 250 },
      { x: 3600, z: 2150 },
      { x: 3600, z: 3650 },
    ],
  },
  // === 5. 大東京 東西メガ横断環状道路（4本 × 9.6 km ノンストップハイウェイ） ===
  {
    id: "gt-road-shinjuku-rainbow-belt",
    displayName:
      "新宿通り・レインボーブリッジ大横断線（中野〜西新宿都庁〜新宿〜田町〜お台場〜有明）",
    routeCode: "都道302号・臨港道路",
    widthMeters: 24.0,
    sidewalkWidthMeters: 4.5,
    lanesPerDirection: 3,
    hasYellowCenterLine: false,
    isBridge: true,
    points: [
      { x: -5400, z: -1850 },
      { x: -4600, z: -1850 },
      { x: -3100, z: -1850 },
      { x: -1640, z: -1850 },
      { x: -920, z: -1850 },
      { x: -380, z: -1850 },
      { x: 0, z: -1850 },
      { x: 650, z: -1850 },
      { x: 1400, z: -1850 },
      { x: 2650, z: -1850 },
      { x: 3600, z: -1850 },
      { x: 4250, z: -1850 },
    ],
  },
  {
    id: "gt-road-outer-north-bay-rim",
    displayName:
      "青梅街道・湾岸国道357号外周線（中野〜新宿歌舞伎町〜市ヶ谷〜品川〜お台場〜東京ビッグサイト）",
    routeCode: "国道357号・都道4号",
    widthMeters: 24.0,
    sidewalkWidthMeters: 4.5,
    lanesPerDirection: 3,
    hasYellowCenterLine: false,
    isBridge: true,
    points: [
      { x: -5400, z: -3400 },
      { x: -4600, z: -3400 },
      { x: -3100, z: -3400 },
      { x: -1640, z: -3400 },
      { x: -920, z: -3400 },
      { x: -380, z: -3400 },
      { x: 0, z: -3400 },
      { x: 650, z: -3400 },
      { x: 2650, z: -3400 },
      { x: 3600, z: -3400 },
      { x: 4250, z: -3400 },
    ],
  },
  {
    id: "gt-road-meguro-ueno-ryogoku-belt",
    displayName:
      "駒沢通り・京葉道路大横断線（世田谷〜中目黒〜麻布十番・東京タワー〜上野〜両国〜錦糸町）",
    routeCode: "国道14号・都道416号",
    widthMeters: 22.0,
    sidewalkWidthMeters: 4.5,
    lanesPerDirection: 3,
    hasYellowCenterLine: false,
    isBridge: true,
    points: [
      { x: -5400, z: 2150 },
      { x: -4600, z: 2150 },
      { x: -3100, z: 2150 },
      { x: -1620, z: 2150 },
      { x: -390, z: 2150 },
      { x: 650, z: 2150 },
      { x: 2100, z: 2150 },
      { x: 3600, z: 2150 },
      { x: 4250, z: 2150 },
    ],
  },
  {
    id: "gt-road-gotanda-asakusa-skytree-rim",
    displayName:
      "目黒通り・浅草通り外周線（自由が丘〜五反田〜後楽園ドーム〜浅草〜隅田川〜東京スカイツリー）",
    routeCode: "東京都道312号・463号",
    widthMeters: 22.0,
    sidewalkWidthMeters: 4.5,
    lanesPerDirection: 3,
    hasYellowCenterLine: false,
    isBridge: true,
    points: [
      { x: -5400, z: 3650 },
      { x: -4600, z: 3650 },
      { x: -3100, z: 3650 },
      { x: -1620, z: 3650 },
      { x: -390, z: 3650 },
      { x: 650, z: 3650 },
      { x: 2100, z: 3650 },
      { x: 3600, z: 3650 },
      { x: 4250, z: 3650 },
    ],
  },
];

export const GREATER_TOKYO_INTERSECTIONS: ReadonlyArray<GreaterTokyoIntersectionSpec> = [
  // 西方主要交差点
  {
    id: "gt-int-sangenjaya",
    nameJa: "三軒茶屋交差点",
    nameEn: "Sangenjaya",
    x: -3100,
    z: 1020,
    width: 32,
    depth: 32,
  },
  {
    id: "gt-int-komazawa",
    nameJa: "駒沢・環七交差点",
    nameEn: "Komazawa Kannana",
    x: -4600,
    z: 1260,
    width: 34,
    depth: 34,
  },
  {
    id: "gt-int-hatsudai",
    nameJa: "初台交差点",
    nameEn: "Hatsudai",
    x: -1640,
    z: -350,
    width: 34,
    depth: 34,
  },
  {
    id: "gt-int-sasazuka",
    nameJa: "笹塚交差点",
    nameEn: "Sasazuka",
    x: -3100,
    z: -350,
    width: 32,
    depth: 32,
  },
  {
    id: "gt-int-daita-kannana",
    nameJa: "代田橋・環七交差点",
    nameEn: "Daitabashi Kannana",
    x: -4600,
    z: -350,
    width: 34,
    depth: 34,
  },
  // 新宿・四ツ谷・品川・お台場帯 (z = -1850)
  {
    id: "gt-int-nakano-sakaue",
    nameJa: "中野坂上交差点",
    nameEn: "Nakano-Sakaue",
    x: -4600,
    z: -1850,
    width: 34,
    depth: 34,
  },
  {
    id: "gt-int-shinjuku-tocho-s",
    nameJa: "西新宿都庁南交差点",
    nameEn: "West Shinjuku Tocho South",
    x: -3100,
    z: -1850,
    width: 34,
    depth: 34,
  },
  {
    id: "gt-int-shinjuku-yamate",
    nameJa: "西新宿・山手通り交差点",
    nameEn: "Nishi-Shinjuku Yamate",
    x: -1640,
    z: -1850,
    width: 34,
    depth: 34,
  },
  {
    id: "gt-int-shinjuku-sanchome",
    nameJa: "新宿三丁目交差点",
    nameEn: "Shinjuku-Sanchome",
    x: -920,
    z: -1850,
    width: 32,
    depth: 32,
  },
  {
    id: "gt-int-yotsuya",
    nameJa: "四ツ谷・外苑東交差点",
    nameEn: "Yotsuya",
    x: -380,
    z: -1850,
    width: 30,
    depth: 30,
  },
  {
    id: "gt-int-tamachi",
    nameJa: "田町・第一京浜交差点",
    nameEn: "Tamachi",
    x: 650,
    z: -1850,
    width: 34,
    depth: 34,
  },
  {
    id: "gt-int-odaiba-center",
    nameJa: "お台場中央交差点",
    nameEn: "Odaiba Central",
    x: 2650,
    z: -1850,
    width: 34,
    depth: 34,
  },
  {
    id: "gt-int-ariake",
    nameJa: "有明・三ツ目通り交差点",
    nameEn: "Ariake",
    x: 3600,
    z: -1850,
    width: 34,
    depth: 34,
  },
  // 最北・品川・お台場リム (z = -3400)
  {
    id: "gt-int-shinjuku-kabukicho",
    nameJa: "新宿歌舞伎町交差点",
    nameEn: "Shinjuku Kabukicho",
    x: -920,
    z: -3400,
    width: 32,
    depth: 32,
  },
  {
    id: "gt-int-shinagawa-sta",
    nameJa: "品川駅前交差点",
    nameEn: "Shinagawa Station",
    x: 650,
    z: -3400,
    width: 34,
    depth: 34,
  },
  {
    id: "gt-int-odaiba-seaside",
    nameJa: "お台場海浜公園交差点",
    nameEn: "Odaiba Seaside",
    x: 2650,
    z: -3400,
    width: 34,
    depth: 34,
  },
  {
    id: "gt-int-bigsight",
    nameJa: "東京ビッグサイト前交差点",
    nameEn: "Tokyo Big Sight",
    x: 3600,
    z: -3400,
    width: 34,
    depth: 34,
  },
  // 築地・勝どき・豊洲・門前仲町
  {
    id: "gt-int-kachidoki",
    nameJa: "勝どき交差点",
    nameEn: "Kachidoki",
    x: 2100,
    z: -350,
    width: 32,
    depth: 32,
  },
  {
    id: "gt-int-toyosu",
    nameJa: "豊洲駅前交差点",
    nameEn: "Toyosu",
    x: 3600,
    z: -350,
    width: 34,
    depth: 34,
  },
  {
    id: "gt-int-monnaka",
    nameJa: "門前仲町交差点",
    nameEn: "Monzennakacho",
    x: 2100,
    z: 250,
    width: 32,
    depth: 32,
  },
  {
    id: "gt-int-kiba",
    nameJa: "木場・東陽町交差点",
    nameEn: "Kiba",
    x: 3600,
    z: 250,
    width: 34,
    depth: 34,
  },
  // 中目黒・東京タワー・上野・両国・錦糸町帯 (z = +2150)
  {
    id: "gt-int-gakugei",
    nameJa: "学芸大学・駒沢通り交差点",
    nameEn: "Gakugei-Daigaku",
    x: -3100,
    z: 2150,
    width: 32,
    depth: 32,
  },
  {
    id: "gt-int-nakameguro",
    nameJa: "中目黒・山手通り交差点",
    nameEn: "Nakameguro",
    x: -1620,
    z: 2150,
    width: 34,
    depth: 34,
  },
  {
    id: "gt-int-azabu-juban",
    nameJa: "麻布十番・広尾交差点",
    nameEn: "Azabu-Juban",
    x: -390,
    z: 2150,
    width: 32,
    depth: 32,
  },
  {
    id: "gt-int-ueno",
    nameJa: "上野駅前交差点",
    nameEn: "Ueno Station",
    x: 650,
    z: 2150,
    width: 34,
    depth: 34,
  },
  {
    id: "gt-int-ryogoku",
    nameJa: "両国・清澄通り交差点",
    nameEn: "Ryogoku",
    x: 2100,
    z: 2150,
    width: 32,
    depth: 32,
  },
  {
    id: "gt-int-kinshicho",
    nameJa: "錦糸町駅前交差点",
    nameEn: "Kinshicho",
    x: 3600,
    z: 2150,
    width: 34,
    depth: 34,
  },
  // 最南・五反田・後楽園・浅草・スカイツリーリム (z = +3650)
  {
    id: "gt-int-gotanda",
    nameJa: "五反田・大崎交差点",
    nameEn: "Gotanda Osaki",
    x: -1620,
    z: 3650,
    width: 34,
    depth: 34,
  },
  {
    id: "gt-int-korakuen",
    nameJa: "後楽園・東京ドーム前交差点",
    nameEn: "Korakuen Tokyo Dome",
    x: -390,
    z: 3650,
    width: 32,
    depth: 32,
  },
  {
    id: "gt-int-asakusa",
    nameJa: "浅草・雷門前交差点",
    nameEn: "Asakusa Kaminarimon",
    x: 650,
    z: 3650,
    width: 34,
    depth: 34,
  },
  {
    id: "gt-int-skytree-front",
    nameJa: "押上・東京スカイツリー前交差点",
    nameEn: "Oshiage Tokyo Skytree",
    x: 3600,
    z: 3650,
    width: 34,
    depth: 34,
  },
];

export const GREATER_TOKYO_LANDMARKS: ReadonlyArray<GreaterTokyoLandmarkSpec> = [
  {
    id: "gt-landmark-tocho",
    nameJa: "東京都庁第一本庁舎（西新宿）",
    nameEn: "Tokyo Metropolitan Government Building",
    usage: "官公庁・超高層タワー",
    chunkId: "shinjuku-west-tocho",
    x: -2450,
    z: -2450,
    width: 112,
    depth: 74,
    height: 243,
    storeys: 48,
    style: "tocho",
  },
  {
    id: "gt-landmark-tokyo-tower",
    nameJa: "東京タワー（芝公園・麻布）",
    nameEn: "Tokyo Tower",
    usage: "電波塔・ランドマーク",
    chunkId: "hiroo-azabu-juban",
    x: -45,
    z: 1780,
    width: 68,
    depth: 68,
    height: 333,
    storeys: 15,
    style: "tokyo_tower",
  },
  {
    id: "gt-landmark-skytree",
    nameJa: "東京スカイツリー（押上・墨田）",
    nameEn: "Tokyo Skytree",
    usage: "自立式電波塔（634m）",
    chunkId: "kinshicho-skytree",
    x: 3860,
    z: 3360,
    width: 78,
    depth: 78,
    height: 634,
    storeys: 30,
    style: "skytree",
  },
  {
    id: "gt-landmark-rainbow-bridge",
    nameJa: "レインボーブリッジ（東京港連絡橋）",
    nameEn: "Rainbow Bridge",
    usage: "吊り橋・臨海幹線",
    chunkId: "odaiba-rainbow-bridge",
    x: 1900,
    z: -1850,
    width: 960,
    depth: 36,
    height: 126,
    storeys: 2,
    style: "rainbow_bridge",
  },
  {
    id: "gt-landmark-carrot-tower",
    nameJa: "キャロットタワー（三軒茶屋）",
    nameEn: "Carrot Tower Sangenjaya",
    usage: "業務・商業・展望施設",
    chunkId: "sangenjaya-ikejiri",
    x: -3280,
    z: 1180,
    width: 58,
    depth: 52,
    height: 124,
    storeys: 26,
    style: "carrot_tower",
  },
  {
    id: "gt-landmark-tokyo-dome",
    nameJa: "東京ドーム（文京・後楽園）",
    nameEn: "Tokyo Dome",
    usage: "ドームスタジアム",
    chunkId: "korakuen-bunkyo",
    x: -160,
    z: 3180,
    width: 210,
    depth: 210,
    height: 56,
    storeys: 6,
    style: "tokyo_dome",
  },
  {
    id: "gt-landmark-fuji-tv",
    nameJa: "フジテレビ本社ビル（お台場）",
    nameEn: "Fuji TV Headquarters Odaiba",
    usage: "放送局・球体展望室",
    chunkId: "odaiba-rainbow-bridge",
    x: 2920,
    z: -2360,
    width: 146,
    depth: 64,
    height: 123,
    storeys: 25,
    style: "fuji_tv",
  },
];

const INNER_CORE_BOUNDS = {
  minX: -1800,
  maxX: 1200,
  minZ: -1200,
  maxZ: 1400,
} as const;

export const OUTER_GREATER_TOKYO_CHUNK_IDS: ReadonlySet<WorldChunkId> = new Set(
  WORLD_CHUNK_DEFINITIONS.filter((def) => {
    const isInsideCoreX =
      def.centerX >= INNER_CORE_BOUNDS.minX && def.centerX <= INNER_CORE_BOUNDS.maxX;
    const isInsideCoreZ =
      def.centerZ >= INNER_CORE_BOUNDS.minZ && def.centerZ <= INNER_CORE_BOUNDS.maxZ;
    return !(isInsideCoreX && isInsideCoreZ);
  }).map((def) => def.id),
);

function distPointToSegment2D(
  px: number,
  pz: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): number {
  const dx = bx - ax;
  const dz = bz - az;
  const lenSq = dx * dx + dz * dz;
  if (lenSq <= 1e-8) {
    return Math.hypot(px - ax, pz - az);
  }
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / lenSq));
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}

/**
 * 大東京外周幹線道路の最近傍道路を検索する（車内カーナビ・GPS表示用）
 */
export function findNearestGreaterTokyoRoad(
  x: number,
  z: number,
): {
  id: string;
  displayName: string;
  routeCode: string;
  distanceMeters: number;
} | null {
  let bestRoad: GreaterTokyoRoadSegmentSpec | null = null;
  let minDist = Number.POSITIVE_INFINITY;

  for (let i = 0; i < GREATER_TOKYO_ARTERIAL_ROADS.length; i++) {
    const road = GREATER_TOKYO_ARTERIAL_ROADS[i];
    for (let p = 0; p < road.points.length - 1; p++) {
      const a = road.points[p];
      const b = road.points[p + 1];
      const d = distPointToSegment2D(x, z, a.x, a.z, b.x, b.z);
      if (d < minDist) {
        minDist = d;
        bestRoad = road;
      }
    }
  }

  if (!bestRoad) {
    return null;
  }
  return {
    id: bestRoad.id,
    displayName: bestRoad.displayName,
    routeCode: bestRoad.routeCode,
    distanceMeters: Math.max(0, Number((minDist - bestRoad.widthMeters * 0.5).toFixed(1))),
  };
}

/**
 * 大東京外周ランドマークの最近傍建物を検索する
 */
export function findNearestGreaterTokyoLandmark(
  x: number,
  z: number,
): {
  landmark: GreaterTokyoLandmarkSpec;
  centerDistanceMeters: number;
  edgeDistanceMeters: number;
} | null {
  let best: GreaterTokyoLandmarkSpec | null = null;
  let minEdge = Number.POSITIVE_INFINITY;
  let bestCenter = Number.POSITIVE_INFINITY;

  for (let i = 0; i < GREATER_TOKYO_LANDMARKS.length; i++) {
    const lm = GREATER_TOKYO_LANDMARKS[i];
    const centerDist = Math.hypot(x - lm.x, z - lm.z);
    const radius = Math.hypot(lm.width, lm.depth) * 0.5;
    const edgeDist = Math.max(0, centerDist - radius);
    if (edgeDist < minEdge) {
      minEdge = edgeDist;
      bestCenter = centerDist;
      best = lm;
    }
  }

  if (!best) {
    return null;
  }
  return {
    landmark: best,
    centerDistanceMeters: Number(bestCenter.toFixed(1)),
    edgeDistanceMeters: Number(minEdge.toFixed(1)),
  };
}

function isInsideWaterBody(x: number, z: number, marginM = 28): boolean {
  // 隅田川本流 (x ∈ [1650, 1920], z ∈ [-1200, 4400])
  const inSumida =
    x >= 1650 - marginM && x <= 1920 + marginM && z >= -1200 - marginM && z <= 4400 + marginM;
  // 東京湾・お台場海域 (x ∈ [1350, 2450], z ∈ [-4200, -1200])
  const inTokyoBay =
    x >= 1350 - marginM && x <= 2450 + marginM && z >= -4200 - marginM && z <= -1200 + marginM;
  return inSumida || inTokyoBay;
}

function isClearOfOuterRoadsAndLandmarks(x: number, z: number, halfFootprint: number): boolean {
  // 既存コア領域には絶対に重ならない
  const isInInnerCore =
    x >= INNER_CORE_BOUNDS.minX - 24 &&
    x <= INNER_CORE_BOUNDS.maxX + 24 &&
    z >= INNER_CORE_BOUNDS.minZ - 24 &&
    z <= INNER_CORE_BOUNDS.maxZ + 24;
  if (isInInnerCore) {
    return false;
  }
  if (isInsideWaterBody(x, z, halfFootprint + 20)) {
    return false;
  }

  for (let i = 0; i < GREATER_TOKYO_ARTERIAL_ROADS.length; i++) {
    const road = GREATER_TOKYO_ARTERIAL_ROADS[i];
    const clearance = road.widthMeters * 0.5 + road.sidewalkWidthMeters + halfFootprint + 6.5;
    for (let p = 0; p < road.points.length - 1; p++) {
      const a = road.points[p];
      const b = road.points[p + 1];
      if (distPointToSegment2D(x, z, a.x, a.z, b.x, b.z) < clearance) {
        return false;
      }
    }
  }

  for (let i = 0; i < GREATER_TOKYO_LANDMARKS.length; i++) {
    const lm = GREATER_TOKYO_LANDMARKS[i];
    const lmClear = Math.max(lm.width, lm.depth) * 0.55 + halfFootprint + 26;
    if (Math.hypot(x - lm.x, z - lm.z) < lmClear) {
      return false;
    }
  }
  return true;
}

function seededRand(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashChunkId(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * 地区ごとの都市ゾーニング特性（新宿超高層街・臨海タワマン・世田谷住宅商業・下町中層）
 */
function resolveDistrictBuildingProfile(chunkId: WorldChunkId): {
  minH: number;
  maxH: number;
  towerRatio: number;
  commercialRatio: number;
  densityCount: number;
} {
  switch (chunkId) {
    case "shinjuku-west-tocho":
    case "shinjuku-kabukicho-east":
    case "yoyogi-shinjuku-south":
      return { minH: 28, maxH: 210, towerRatio: 0.58, commercialRatio: 0.3, densityCount: 92 };
    case "odaiba-rainbow-bridge":
    case "ariake-tokyo-bigsight":
    case "toyosu-harumi":
    case "shinagawa-tamachi":
    case "shinagawa-tennozu":
      return { minH: 24, maxH: 175, towerRatio: 0.52, commercialRatio: 0.34, densityCount: 84 };
    case "sangenjaya-ikejiri":
    case "hatsudai-sasazuka":
    case "meguro-nakameguro":
    case "gotanda-osaki":
    case "hiroo-azabu-juban":
    case "tsukiji-kachidoki":
    case "kinshicho-skytree":
    case "ueno-okachimachi":
      return { minH: 18, maxH: 118, towerRatio: 0.3, commercialRatio: 0.45, densityCount: 86 };
    default:
      return { minH: 10, maxH: 58, towerRatio: 0.14, commercialRatio: 0.38, densityCount: 82 };
  }
}

/**
 * 複数クワッド群から単一の統合 BufferGeometry を高速構築するビルダー
 * Why 1メッシュ統合か: 125km 超の広域道路・標示・歩道を個別 THREE.Mesh で生成すると
 * 数千ドローコールと初期化遅延を引き起こすため、マテリアル種別ごとに頂点バッファを1発統合する。
 */
class QuadBatchBuilder {
  private positions: number[] = [];
  private normals: number[] = [];
  private uvs: number[] = [];
  private indices: number[] = [];

  public addQuad(
    p0: [number, number, number],
    p1: [number, number, number],
    p2: [number, number, number],
    p3: [number, number, number],
    nx: number,
    ny: number,
    nz: number,
    uMax = 1,
    vMax = 1,
  ): void {
    const base = this.positions.length / 3;
    this.positions.push(
      p0[0],
      p0[1],
      p0[2],
      p1[0],
      p1[1],
      p1[2],
      p2[0],
      p2[1],
      p2[2],
      p3[0],
      p3[1],
      p3[2],
    );
    for (let i = 0; i < 4; i++) {
      this.normals.push(nx, ny, nz);
    }
    this.uvs.push(0, 0, uMax, 0, uMax, vMax, 0, vMax);
    this.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  public addHorizontalRect(
    cx: number,
    cz: number,
    w: number,
    d: number,
    y: number,
    uTile = 1,
    vTile = 1,
  ): void {
    const hw = w * 0.5;
    const hd = d * 0.5;
    this.addQuad(
      [cx - hw, y, cz + hd],
      [cx + hw, y, cz + hd],
      [cx + hw, y, cz - hd],
      [cx - hw, y, cz - hd],
      0,
      1,
      0,
      uTile,
      vTile,
    );
  }

  public addRibbonQuad(
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
    rightX: number,
    rightZ: number,
    offsetStart: number,
    offsetEnd: number,
    yBoost: number,
    uTile = 1,
    vTile = 1,
  ): void {
    const p0: [number, number, number] = [
      ax + rightX * offsetStart,
      ay + yBoost,
      az + rightZ * offsetStart,
    ];
    const p1: [number, number, number] = [
      ax + rightX * offsetEnd,
      ay + yBoost,
      az + rightZ * offsetEnd,
    ];
    const p2: [number, number, number] = [
      bx + rightX * offsetEnd,
      by + yBoost,
      bz + rightZ * offsetEnd,
    ];
    const p3: [number, number, number] = [
      bx + rightX * offsetStart,
      by + yBoost,
      bz + rightZ * offsetStart,
    ];
    // +Y 上向き法線になるよう反時計回り (p0 -> p1 -> p2 -> p3 または逆順をクロス積で保証)
    const ux = p1[0] - p0[0];
    const uz = p1[2] - p0[2];
    const vx = p3[0] - p0[0];
    const vz = p3[2] - p0[2];
    const crossY = uz * vx - ux * vz;
    if (crossY >= 0) {
      this.addQuad(p0, p1, p2, p3, 0, 1, 0, uTile, vTile);
    } else {
      this.addQuad(p0, p3, p2, p1, 0, 1, 0, uTile, vTile);
    }
  }

  public buildGeometry(): THREE.BufferGeometry {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(this.positions, 3));
    geo.setAttribute("normal", new THREE.Float32BufferAttribute(this.normals, 3));
    geo.setAttribute("uv", new THREE.Float32BufferAttribute(this.uvs, 2));
    geo.setIndex(this.indices);
    geo.computeBoundingSphere();
    return geo;
  }
}

/**
 * 側面のみ建築ファサード UV を割り当て、天面(屋上)の UV を非発光コーナータグへ畳んだ InstancedMesh 用ユニットボックス。
 * 屋上への窓柄滲み・夜間屋上誤発光をゼロにし、高さ階層ごとの適正窓アスペクト比を維持する。
 */
function createFacadeUnitBoxGeometry(uRepeat: number, vRepeat: number): THREE.BoxGeometry {
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  const normal = geo.attributes.normal as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) {
    const ny = normal.getY(i);
    if (Math.abs(ny) > 0.5) {
      // 屋上・底面は非発光の暗色コーナーピクセル (0.005, 0.005) を参照
      uv.setXY(i, 0.005, 0.005);
    } else {
      uv.setXY(i, uv.getX(i) * uRepeat, uv.getY(i) * vRepeat);
    }
  }
  uv.needsUpdate = true;
  return geo;
}

/**
 * 大東京 10倍拡張ワールド（125km超幹線道路・28外周チャンク約2,200棟ビル・東京湾/隅田川・7大ランドマーク）を構築する。
 */
export function buildGreaterTokyoExpansion(params: {
  world: RAPIER.World;
  rapier: typeof RAPIER;
  staticBody: RAPIER.RigidBody;
  sampleTerrainY: (x: number, z: number) => number;
  isNightActive: boolean;
  registerObstacleCollider: (collider: RAPIER.Collider) => void;
}): GreaterTokyoExpansionBundle {
  const { world, rapier, staticBody, sampleTerrainY, isNightActive, registerObstacleCollider } =
    params;

  const rootGroup = new THREE.Group();
  rootGroup.name = "GreaterTokyoTenfoldExpansionRoot";

  const roadNetworkGroup = new THREE.Group();
  roadNetworkGroup.name = "GreaterTokyoArterialRoadNetwork";
  roadNetworkGroup.userData.isRoadInfrastructure = true;

  const waterGroup = new THREE.Group();
  waterGroup.name = "GreaterTokyoBayAndSumidaWater";
  waterGroup.userData.isRoadInfrastructure = true;

  const landmarksGroup = new THREE.Group();
  landmarksGroup.name = "GreaterTokyoSignatureLandmarks";
  landmarksGroup.userData.isLargeStructure = true;
  landmarksGroup.userData.maxLodDrawDistance = 5200;

  const emissiveEntries: GreaterTokyoEmissiveEntry[] = [];

  // 1. 広域道路・標示・歩道・交差点パッド・街灯の一括バッチ構築
  const asphaltBatch = new QuadBatchBuilder();
  const sidewalkBatch = new QuadBatchBuilder();
  const whiteMarkingBatch = new QuadBatchBuilder();
  const yellowMarkingBatch = new QuadBatchBuilder();
  const bridgeParapetBatch = new QuadBatchBuilder();
  const lampPositions: Array<{ x: number; y: number; z: number; yaw: number }> = [];

  let totalRoadLengthM = 0;

  for (let rIdx = 0; rIdx < GREATER_TOKYO_ARTERIAL_ROADS.length; rIdx++) {
    const road = GREATER_TOKYO_ARTERIAL_ROADS[rIdx];
    const halfRoadW = road.widthMeters * 0.5;
    const swW = road.sidewalkWidthMeters;

    for (let sIdx = 0; sIdx < road.points.length - 1; sIdx++) {
      const a = road.points[sIdx];
      const b = road.points[sIdx + 1];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const segLen = Math.hypot(dx, dz);
      if (segLen < 1.0) {
        continue;
      }
      totalRoadLengthM += segLen;
      const dirX = dx / segLen;
      const dirZ = dz / segLen;
      const rightX = -dirZ;
      const rightZ = dirX;

      // 渋谷起伏テーパー区間（x < -395）は 40m ごとに分割して地形標高へ滑らかに追従
      const needsSubdiv = a.x < -395 || b.x < -395;
      const subSteps = needsSubdiv
        ? Math.max(1, Math.ceil(segLen / 40))
        : Math.max(1, Math.ceil(segLen / 220));

      for (let k = 0; k < subSteps; k++) {
        const t0 = k / subSteps;
        const t1 = (k + 1) / subSteps;
        const p0x = a.x + dx * t0;
        const p0z = a.z + dz * t0;
        const p1x = a.x + dx * t1;
        const p1z = a.z + dz * t1;
        const y0 = p0x < -395 ? sampleTerrainY(p0x, p0z) : 0;
        const y1 = p1x < -395 ? sampleTerrainY(p1x, p1z) : 0;
        const subLen = segLen / subSteps;

        // アスファルト車道本体
        asphaltBatch.addRibbonQuad(
          p0x,
          y0,
          p0z,
          p1x,
          y1,
          p1z,
          rightX,
          rightZ,
          -halfRoadW,
          halfRoadW,
          0.018,
          1,
          subLen / 12,
        );

        // 両側歩道プレート（車道外縁〜歩道外端）
        sidewalkBatch.addRibbonQuad(
          p0x,
          y0,
          p0z,
          p1x,
          y1,
          p1z,
          rightX,
          rightZ,
          -halfRoadW - swW,
          -halfRoadW,
          0.16,
          1,
          subLen / 8,
        );
        sidewalkBatch.addRibbonQuad(
          p0x,
          y0,
          p0z,
          p1x,
          y1,
          p1z,
          rightX,
          rightZ,
          halfRoadW,
          halfRoadW + swW,
          0.16,
          1,
          subLen / 8,
        );

        // 外側線（白実線）
        whiteMarkingBatch.addRibbonQuad(
          p0x,
          y0,
          p0z,
          p1x,
          y1,
          p1z,
          rightX,
          rightZ,
          -halfRoadW + 0.35,
          -halfRoadW + 0.55,
          0.032,
        );
        whiteMarkingBatch.addRibbonQuad(
          p0x,
          y0,
          p0z,
          p1x,
          y1,
          p1z,
          rightX,
          rightZ,
          halfRoadW - 0.55,
          halfRoadW - 0.35,
          0.032,
        );

        // 中央線（オレンジ黄線または複線白線）
        if (road.hasYellowCenterLine) {
          yellowMarkingBatch.addRibbonQuad(
            p0x,
            y0,
            p0z,
            p1x,
            y1,
            p1z,
            rightX,
            rightZ,
            -0.22,
            0.22,
            0.034,
          );
        } else {
          whiteMarkingBatch.addRibbonQuad(
            p0x,
            y0,
            p0z,
            p1x,
            y1,
            p1z,
            rightX,
            rightZ,
            -0.32,
            -0.12,
            0.034,
          );
          whiteMarkingBatch.addRibbonQuad(
            p0x,
            y0,
            p0z,
            p1x,
            y1,
            p1z,
            rightX,
            rightZ,
            0.12,
            0.32,
            0.034,
          );
        }

        // 橋梁区間（水上）の側面高欄
        const midX = (p0x + p1x) * 0.5;
        const midZ = (p0z + p1z) * 0.5;
        if (road.isBridge && isInsideWaterBody(midX, midZ, 30)) {
          for (const side of [-1, 1] as const) {
            const off = side * (halfRoadW + swW);
            bridgeParapetBatch.addQuad(
              [p0x + rightX * off, y0 + 0.16, p0z + rightZ * off],
              [p1x + rightX * off, y1 + 0.16, p1z + rightZ * off],
              [p1x + rightX * off, y1 + 1.25, p1z + rightZ * off],
              [p0x + rightX * off, y0 + 1.25, p0z + rightZ * off],
              rightX * side,
              0,
              rightZ * side,
            );
          }
        }
      }

      // 車線境界破線（8m 描線 / 12m 空白、片側複数車線時）
      const laneW = (halfRoadW - 0.8) / Math.max(1, road.lanesPerDirection);
      for (let lane = 1; lane < road.lanesPerDirection; lane++) {
        for (const side of [-1, 1] as const) {
          const laneOffset = side * (lane * laneW);
          for (let d = 22; d < segLen - 22; d += 22) {
            const dEnd = Math.min(d + 8.5, segLen - 18);
            const sx = a.x + dirX * d;
            const sz = a.z + dirZ * d;
            const ex = a.x + dirX * dEnd;
            const ez = a.z + dirZ * dEnd;
            const sy = sx < -395 ? sampleTerrainY(sx, sz) : 0;
            const ey = ex < -395 ? sampleTerrainY(ex, ez) : 0;
            whiteMarkingBatch.addRibbonQuad(
              sx,
              sy,
              sz,
              ex,
              ey,
              ez,
              rightX,
              rightZ,
              laneOffset - 0.09,
              laneOffset + 0.09,
              0.033,
            );
          }
        }
      }

      // 沿道道路照明灯（95m 間隔で交互配置）
      const lampYaw = Math.atan2(dirX, dirZ);
      for (let d = 48; d < segLen - 42; d += 95) {
        const lx = a.x + dirX * d;
        const lz = a.z + dirZ * d;
        const ly = lx < -395 ? sampleTerrainY(lx, lz) : 0;
        const side = Math.floor(d / 95) % 2 === 0 ? 1 : -1;
        const off = side * (halfRoadW + 1.2);
        lampPositions.push({
          x: lx + rightX * off,
          y: ly + 0.16,
          z: lz + rightZ * off,
          yaw: side > 0 ? lampYaw + Math.PI * 0.5 : lampYaw - Math.PI * 0.5,
        });
      }
    }
  }

  // 主要外周交差点フラットパッド＆横断歩道ゼブラ標示
  for (let i = 0; i < GREATER_TOKYO_INTERSECTIONS.length; i++) {
    const inter = GREATER_TOKYO_INTERSECTIONS[i];
    const iy = inter.x < -395 ? sampleTerrainY(inter.x, inter.z) : 0;
    asphaltBatch.addHorizontalRect(inter.x, inter.z, inter.width + 6, inter.depth + 6, iy + 0.025);
    // 4方向ゼブラ横断歩道
    const halfW = inter.width * 0.5 + 1.5;
    const halfD = inter.depth * 0.5 + 1.5;
    for (let s = -9; s <= 9; s += 2.2) {
      whiteMarkingBatch.addHorizontalRect(inter.x + s, inter.z + halfD, 0.9, 3.6, iy + 0.038);
      whiteMarkingBatch.addHorizontalRect(inter.x + s, inter.z - halfD, 0.9, 3.6, iy + 0.038);
      whiteMarkingBatch.addHorizontalRect(inter.x + halfW, inter.z + s, 3.6, 0.9, iy + 0.038);
      whiteMarkingBatch.addHorizontalRect(inter.x - halfW, inter.z + s, 3.6, 0.9, iy + 0.038);
    }
  }

  const asphaltMat = new THREE.MeshStandardMaterial({
    name: "GreaterTokyoAsphaltMat",
    color: 0x2a2e35,
    roughness: 0.86,
    metalness: 0.06,
  });
  const asphaltMesh = new THREE.Mesh(asphaltBatch.buildGeometry(), asphaltMat);
  asphaltMesh.name = "GreaterTokyoAsphaltBatch";
  asphaltMesh.userData.isRoadInfrastructure = true;
  asphaltMesh.receiveShadow = true;
  roadNetworkGroup.add(asphaltMesh);

  const sidewalkMat = new THREE.MeshStandardMaterial({
    name: "GreaterTokyoSidewalkMat",
    color: 0x8b8e93,
    roughness: 0.84,
    metalness: 0.04,
  });
  const sidewalkMesh = new THREE.Mesh(sidewalkBatch.buildGeometry(), sidewalkMat);
  sidewalkMesh.name = "GreaterTokyoSidewalkBatch";
  sidewalkMesh.userData.isRoadInfrastructure = true;
  sidewalkMesh.receiveShadow = true;
  roadNetworkGroup.add(sidewalkMesh);

  const whiteMarkMat = new THREE.MeshStandardMaterial({
    name: "GreaterTokyoWhiteMarkingMat",
    color: 0xf1f5f9,
    roughness: 0.65,
    metalness: 0.02,
  });
  const whiteMarkMesh = new THREE.Mesh(whiteMarkingBatch.buildGeometry(), whiteMarkMat);
  whiteMarkMesh.name = "GreaterTokyoWhiteMarkingsBatch";
  whiteMarkMesh.userData.isRoadInfrastructure = true;
  roadNetworkGroup.add(whiteMarkMesh);

  const yellowMarkMat = new THREE.MeshStandardMaterial({
    name: "GreaterTokyoYellowMarkingMat",
    color: 0xf59e0b,
    roughness: 0.62,
    metalness: 0.02,
  });
  const yellowMarkMesh = new THREE.Mesh(yellowMarkingBatch.buildGeometry(), yellowMarkMat);
  yellowMarkMesh.name = "GreaterTokyoYellowMarkingsBatch";
  yellowMarkMesh.userData.isRoadInfrastructure = true;
  roadNetworkGroup.add(yellowMarkMesh);

  const parapetMat = new THREE.MeshStandardMaterial({
    name: "GreaterTokyoBridgeParapetMat",
    color: 0xcbd5e1,
    roughness: 0.55,
    metalness: 0.28,
    side: THREE.DoubleSide,
  });
  const parapetMesh = new THREE.Mesh(bridgeParapetBatch.buildGeometry(), parapetMat);
  parapetMesh.name = "GreaterTokyoBridgeParapetsBatch";
  parapetMesh.userData.isRoadInfrastructure = true;
  roadNetworkGroup.add(parapetMesh);

  // 街灯 InstancedMesh (ポール＋夜間発光ランプヘッドの2ドローコール)
  if (lampPositions.length > 0) {
    const poleGeo = new THREE.CylinderGeometry(0.11, 0.16, 8.2, 6);
    const poleMat = new THREE.MeshStandardMaterial({
      name: "GreaterTokyoLampPoleMat",
      color: 0x475569,
      roughness: 0.45,
      metalness: 0.65,
    });
    const headGeo = new THREE.BoxGeometry(1.6, 0.24, 0.52);
    const headMat = new THREE.MeshStandardMaterial({
      name: "GreaterTokyoLampHeadMat",
      color: 0xfff7ed,
      emissive: new THREE.Color(0xffdfa8),
      emissiveIntensity: isNightActive ? 2.2 : 0.05,
      roughness: 0.3,
      metalness: 0.2,
    });
    emissiveEntries.push({ material: headMat, dayIntensity: 0.05, nightIntensity: 2.2 });

    const poleInst = new THREE.InstancedMesh(poleGeo, poleMat, lampPositions.length);
    poleInst.name = "GreaterTokyoStreetLampPoles";
    poleInst.userData.isRoadInfrastructure = true;
    const headInst = new THREE.InstancedMesh(headGeo, headMat, lampPositions.length);
    headInst.name = "GreaterTokyoStreetLampHeads";
    headInst.userData.isRoadInfrastructure = true;

    const dummy = new THREE.Object3D();
    for (let i = 0; i < lampPositions.length; i++) {
      const lp = lampPositions[i];
      dummy.position.set(lp.x, lp.y + 4.1, lp.z);
      dummy.rotation.set(0, lp.yaw, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      poleInst.setMatrixAt(i, dummy.matrix);

      dummy.position.set(lp.x - Math.sin(lp.yaw) * 0.7, lp.y + 8.15, lp.z - Math.cos(lp.yaw) * 0.7);
      dummy.updateMatrix();
      headInst.setMatrixAt(i, dummy.matrix);
    }
    poleInst.instanceMatrix.needsUpdate = true;
    headInst.instanceMatrix.needsUpdate = true;
    roadNetworkGroup.add(poleInst, headInst);
  }

  // 2. 東京湾・隅田川の水面表現（勝鬨橋・永代橋・両国橋・レインボーブリッジ下）
  const waterMat = new THREE.MeshStandardMaterial({
    name: "GreaterTokyoWaterSurfaceMat",
    color: 0x163854,
    roughness: 0.16,
    metalness: 0.42,
  });
  const sumidaWater = new THREE.Mesh(new THREE.PlaneGeometry(270, 5600), waterMat);
  sumidaWater.name = "SumidaRiverWaterSurface";
  sumidaWater.rotation.x = -Math.PI / 2;
  sumidaWater.position.set(1785, -0.004, 1600);
  waterGroup.add(sumidaWater);

  const bayWater = new THREE.Mesh(new THREE.PlaneGeometry(1100, 3000), waterMat);
  bayWater.name = "TokyoBayWaterSurface";
  bayWater.rotation.x = -Math.PI / 2;
  bayWater.position.set(1900, -0.004, -2700);
  waterGroup.add(bayWater);

  // 3. 28外周チャンクの高密度ビル街（Blender ベイク済み LOD テクスチャ＋夜間窓専用発光マスク共用）
  const sharedGlassMat = new THREE.MeshStandardMaterial({
    name: "GreaterTokyoGlassMat",
    color: 0xffffff,
    map: shibuyaTextureManager.getGlbTexture("plateauLod0Glass"),
    emissive: new THREE.Color(0xe6f1ff),
    emissiveMap: shibuyaTextureManager.getGlbTexture("plateauLod0GlassEmissive"),
    emissiveIntensity: isNightActive ? 1.15 : 0.02,
    roughness: 0.24,
    metalness: 0.44,
  });
  const sharedCommMat = new THREE.MeshStandardMaterial({
    name: "GreaterTokyoCommercialMat",
    color: 0xffffff,
    map: shibuyaTextureManager.getGlbTexture("plateauLod0Commercial"),
    emissive: new THREE.Color(0xfff2dc),
    emissiveMap: shibuyaTextureManager.getGlbTexture("plateauLod0CommercialEmissive"),
    emissiveIntensity: isNightActive ? 1.14 : 0.02,
    roughness: 0.46,
    metalness: 0.18,
  });
  const sharedAlleyMat = new THREE.MeshStandardMaterial({
    name: "GreaterTokyoAlleyMat",
    color: 0xffffff,
    map: shibuyaTextureManager.getGlbTexture("plateauLod0Alley"),
    emissive: new THREE.Color(0xfff0d4),
    emissiveMap: shibuyaTextureManager.getGlbTexture("plateauLod0AlleyEmissive"),
    emissiveIntensity: isNightActive ? 1.14 : 0.02,
    roughness: 0.52,
    metalness: 0.12,
  });
  const sharedRoofCapMat = new THREE.MeshStandardMaterial({
    name: "GreaterTokyoRoofCapMat",
    color: 0x3b424d,
    roughness: 0.82,
    metalness: 0.08,
  });
  emissiveEntries.push(
    { material: sharedGlassMat, dayIntensity: 0.02, nightIntensity: 1.15 },
    { material: sharedCommMat, dayIntensity: 0.02, nightIntensity: 1.14 },
    { material: sharedAlleyMat, dayIntensity: 0.02, nightIntensity: 1.14 },
  );

  // 高さ階層別の適正アスペクト比ユニットボックス（窓引き伸ばしゼロ）
  const lowBoxGeo = createFacadeUnitBoxGeometry(2.0, 1.0);
  const midBoxGeo = createFacadeUnitBoxGeometry(2.5, 2.5);
  const highBoxGeo = createFacadeUnitBoxGeometry(3.0, 6.0);
  const roofCapGeo = new THREE.BoxGeometry(1, 1, 1);

  const outerChunkGroups = new Map<WorldChunkId, THREE.Group>();
  const outerChunkBuildingSpecs = new Map<WorldChunkId, OuterBuildingBox[]>();
  const activeOuterChunkColliders = new Map<WorldChunkId, RAPIER.Collider[]>();
  let totalOuterBuildingCount = 0;

  const dummyMat4 = new THREE.Object3D();
  const colorHelper = new THREE.Color();

  for (let cIdx = 0; cIdx < WORLD_CHUNK_DEFINITIONS.length; cIdx++) {
    const def: WorldChunkDefinition = WORLD_CHUNK_DEFINITIONS[cIdx];
    if (!OUTER_GREATER_TOKYO_CHUNK_IDS.has(def.id)) {
      continue;
    }

    const profile = resolveDistrictBuildingProfile(def.id);
    const rng = seededRand(hashChunkId(def.id));
    const buildings: OuterBuildingBox[] = [];

    const spanX = def.bounds.maxX - def.bounds.minX;
    const spanZ = def.bounds.maxZ - def.bounds.minZ;
    const maxAttempts = profile.densityCount * 6;

    for (
      let attempt = 0;
      attempt < maxAttempts && buildings.length < profile.densityCount;
      attempt++
    ) {
      const bx = def.bounds.minX + 36 + rng() * Math.max(40, spanX - 72);
      const bz = def.bounds.minZ + 36 + rng() * Math.max(40, spanZ - 72);

      const styleRoll = rng();
      let style: "glass" | "commercial" | "alley";
      let w: number;
      let d: number;
      let h: number;

      if (styleRoll < profile.towerRatio) {
        style = "glass";
        w = 34 + rng() * 34;
        d = 30 + rng() * 32;
        h = Math.max(45, profile.minH + rng() * (profile.maxH - profile.minH));
      } else if (styleRoll < profile.towerRatio + profile.commercialRatio) {
        style = "commercial";
        w = 24 + rng() * 28;
        d = 22 + rng() * 26;
        h = Math.min(profile.maxH * 0.65, profile.minH + rng() * 44);
      } else {
        style = "alley";
        w = 18 + rng() * 22;
        d = 16 + rng() * 20;
        h = Math.min(34, profile.minH + rng() * 20);
      }

      const halfDiag = Math.hypot(w, d) * 0.5;
      if (!isClearOfOuterRoadsAndLandmarks(bx, bz, halfDiag)) {
        continue;
      }

      // 同一チャンク内既存ビルとの重なり防止
      let overlapsExisting = false;
      for (let eIdx = 0; eIdx < buildings.length; eIdx++) {
        const ex = buildings[eIdx];
        const minSepX = (w + ex.w) * 0.5 + 8.0;
        const minSepZ = (d + ex.d) * 0.5 + 8.0;
        if (Math.abs(bx - ex.x) < minSepX && Math.abs(bz - ex.z) < minSepZ) {
          overlapsExisting = true;
          break;
        }
      }
      if (overlapsExisting) {
        continue;
      }

      const tintPalette =
        style === "glass"
          ? [0xdbeafe, 0xe2e8f0, 0xcbd5e1, 0xbfdbfe]
          : style === "commercial"
            ? [0xf8fafc, 0xf1f5f9, 0xe7e5e4, 0xf5f5f4]
            : [0xf5f5f4, 0xe7e5e4, 0xfef3c7, 0xd6d3d1];
      const tint = tintPalette[Math.floor(rng() * tintPalette.length)];
      buildings.push({ x: bx, z: bz, w, d, h, yaw: 0, style, tint });
    }

    outerChunkBuildingSpecs.set(def.id, buildings);
    totalOuterBuildingCount += buildings.length;

    const chunkGroup = new THREE.Group();
    chunkGroup.name = `GreaterTokyoChunk_${def.id}`;
    chunkGroup.userData.isLargeStructure = true;
    chunkGroup.userData.outerChunkId = def.id;
    chunkGroup.userData.maxLodDrawDistance = 2600;

    const buckets: Array<{
      label: string;
      geo: THREE.BoxGeometry;
      mat: THREE.MeshStandardMaterial;
      items: OuterBuildingBox[];
    }> = [
      {
        label: "GlassHigh",
        geo: highBoxGeo,
        mat: sharedGlassMat,
        items: buildings.filter((b) => b.style === "glass"),
      },
      {
        label: "CommMid",
        geo: midBoxGeo,
        mat: sharedCommMat,
        items: buildings.filter((b) => b.style === "commercial"),
      },
      {
        label: "AlleyLow",
        geo: lowBoxGeo,
        mat: sharedAlleyMat,
        items: buildings.filter((b) => b.style === "alley"),
      },
    ];

    for (let bIdx = 0; bIdx < buckets.length; bIdx++) {
      const bucket = buckets[bIdx];
      if (bucket.items.length === 0) {
        continue;
      }
      const inst = new THREE.InstancedMesh(bucket.geo, bucket.mat, bucket.items.length);
      inst.name = `GreaterTokyo_${def.id}_${bucket.label}`;
      inst.castShadow = false;
      inst.receiveShadow = true;
      for (let i = 0; i < bucket.items.length; i++) {
        const b = bucket.items[i];
        const gy = b.x < -395 ? sampleTerrainY(b.x, b.z) : 0;
        dummyMat4.position.set(b.x, gy + b.h * 0.5, b.z);
        dummyMat4.rotation.set(0, b.yaw, 0);
        dummyMat4.scale.set(b.w, b.h, b.d);
        dummyMat4.updateMatrix();
        inst.setMatrixAt(i, dummyMat4.matrix);
        colorHelper.setHex(b.tint);
        inst.setColorAt(i, colorHelper);
      }
      inst.instanceMatrix.needsUpdate = true;
      if (inst.instanceColor) {
        inst.instanceColor.needsUpdate = true;
      }
      chunkGroup.add(inst);
    }

    if (buildings.length > 0) {
      const roofInst = new THREE.InstancedMesh(roofCapGeo, sharedRoofCapMat, buildings.length);
      roofInst.name = `GreaterTokyo_${def.id}_RoofCaps`;
      for (let i = 0; i < buildings.length; i++) {
        const b = buildings[i];
        const gy = b.x < -395 ? sampleTerrainY(b.x, b.z) : 0;
        dummyMat4.position.set(b.x, gy + b.h + 0.45, b.z);
        dummyMat4.rotation.set(0, b.yaw, 0);
        dummyMat4.scale.set(b.w + 0.35, 0.9, b.d + 0.35);
        dummyMat4.updateMatrix();
        roofInst.setMatrixAt(i, dummyMat4.matrix);
      }
      roofInst.instanceMatrix.needsUpdate = true;
      chunkGroup.add(roofInst);
    }

    outerChunkGroups.set(def.id, chunkGroup);
    rootGroup.add(chunkGroup);
  }

  // 4. 7大象徴ランドマーク造形（遠景スカイライン常時視認＋実物物理コライダー）
  const landmarkSteelWhite = new THREE.MeshStandardMaterial({
    name: "GreaterTokyoLandmarkWhiteSteel",
    color: 0xe2e8f0,
    roughness: 0.35,
    metalness: 0.48,
  });
  const landmarkTowerRed = new THREE.MeshStandardMaterial({
    name: "GreaterTokyoTokyoTowerRed",
    color: 0xea580c,
    emissive: new THREE.Color(0xff7a2f),
    emissiveIntensity: isNightActive ? 0.85 : 0.02,
    roughness: 0.4,
    metalness: 0.42,
  });
  const landmarkSkytreeBand = new THREE.MeshStandardMaterial({
    name: "GreaterTokyoSkytreeGlow",
    color: 0x38bdf8,
    emissive: new THREE.Color(0x38bdf8),
    emissiveIntensity: isNightActive ? 1.85 : 0.08,
    roughness: 0.2,
    metalness: 0.3,
  });
  const landmarkBridgeGlow = new THREE.MeshStandardMaterial({
    name: "GreaterTokyoRainbowBridgeGlow",
    color: 0xf8fafc,
    emissive: new THREE.Color(0xfef3c7),
    emissiveIntensity: isNightActive ? 1.55 : 0.04,
    roughness: 0.3,
    metalness: 0.5,
  });
  const landmarkCarrotMat = new THREE.MeshStandardMaterial({
    name: "GreaterTokyoCarrotTowerMat",
    color: 0xb45309,
    map: shibuyaTextureManager.getGlbTexture("plateauLod0Commercial"),
    emissive: new THREE.Color(0xfde68a),
    emissiveMap: shibuyaTextureManager.getGlbTexture("plateauLod0CommercialEmissive"),
    emissiveIntensity: isNightActive ? 1.1 : 0.02,
    roughness: 0.48,
    metalness: 0.16,
  });
  const landmarkDomeMat = new THREE.MeshStandardMaterial({
    name: "GreaterTokyoDomeMembraneMat",
    color: 0xf8fafc,
    emissive: new THREE.Color(0xe0f2fe),
    emissiveIntensity: isNightActive ? 0.55 : 0.02,
    roughness: 0.58,
    metalness: 0.06,
  });
  const beaconRedMat = new THREE.MeshBasicMaterial({ color: 0xef4444 });

  emissiveEntries.push(
    { material: landmarkTowerRed, dayIntensity: 0.02, nightIntensity: 0.85 },
    { material: landmarkSkytreeBand, dayIntensity: 0.08, nightIntensity: 1.85 },
    { material: landmarkBridgeGlow, dayIntensity: 0.04, nightIntensity: 1.55 },
    { material: landmarkCarrotMat, dayIntensity: 0.02, nightIntensity: 1.1 },
    { material: landmarkDomeMat, dayIntensity: 0.02, nightIntensity: 0.55 },
  );

  for (let i = 0; i < GREATER_TOKYO_LANDMARKS.length; i++) {
    const lm = GREATER_TOKYO_LANDMARKS[i];
    const lmGroup = new THREE.Group();
    lmGroup.name = lm.id;
    lmGroup.position.set(lm.x, 0, lm.z);
    lmGroup.userData = {
      buildingId: lm.id,
      name: lm.nameJa,
      nameEn: lm.nameEn,
      measuredHeight: lm.height,
      isLargeStructure: true,
      maxLodDrawDistance: 5200,
    };

    if (lm.style === "tocho") {
      // 東京都庁第一本庁舎：基壇(140m)＋象徴的なツインタワー(243m)
      const base = new THREE.Mesh(new THREE.BoxGeometry(108, 145, 68), sharedGlassMat);
      base.position.y = 72.5;
      const northTower = new THREE.Mesh(new THREE.BoxGeometry(40, 98, 56), sharedGlassMat);
      northTower.position.set(-28, 194, 0);
      const southTower = new THREE.Mesh(new THREE.BoxGeometry(40, 98, 56), sharedGlassMat);
      southTower.position.set(28, 194, 0);
      const beaconL = new THREE.Mesh(new THREE.SphereGeometry(2.2, 8, 8), beaconRedMat);
      beaconL.position.set(-28, 245, 0);
      const beaconR = new THREE.Mesh(new THREE.SphereGeometry(2.2, 8, 8), beaconRedMat);
      beaconR.position.set(28, 245, 0);
      lmGroup.add(base, northTower, southTower, beaconL, beaconR);
    } else if (lm.style === "tokyo_tower") {
      // 東京タワー (333m)：赤白段違いテーパー構造＋メイン/トップ展望台＋アンテナ尖塔
      const bands: Array<[number, number, number, number, boolean]> = [
        [0, 72, 34, 21, true],
        [72, 138, 21, 13, false],
        [138, 200, 13, 8.5, true],
        [200, 250, 8.5, 5.2, false],
        [250, 300, 4.4, 2.2, true],
        [300, 333, 1.8, 0.4, false],
      ];
      for (const [y0, y1, rBot, rTop, isRed] of bands) {
        const seg = new THREE.Mesh(
          new THREE.CylinderGeometry(rTop, rBot, y1 - y0, 4),
          isRed ? landmarkTowerRed : landmarkSteelWhite,
        );
        seg.rotation.y = Math.PI * 0.25;
        seg.position.y = (y0 + y1) * 0.5;
        lmGroup.add(seg);
      }
      const mainDeck = new THREE.Mesh(new THREE.BoxGeometry(30, 14, 30), landmarkSteelWhite);
      mainDeck.position.y = 150;
      const topDeck = new THREE.Mesh(new THREE.BoxGeometry(15, 10, 15), landmarkSteelWhite);
      topDeck.position.y = 250;
      const topBeacon = new THREE.Mesh(new THREE.SphereGeometry(2.4, 8, 8), beaconRedMat);
      topBeacon.position.y = 334;
      lmGroup.add(mainDeck, topDeck, topBeacon);
    } else if (lm.style === "skytree") {
      // 東京スカイツリー (634m)：白藍鉄骨テーパー＋天望デッキ(350m)＋天望回廊(450m)＋発光帯
      const lowerShaft = new THREE.Mesh(
        new THREE.CylinderGeometry(16, 36, 345, 12),
        landmarkSteelWhite,
      );
      lowerShaft.position.y = 172.5;
      const deck350 = new THREE.Mesh(
        new THREE.CylinderGeometry(28, 24, 22, 16),
        landmarkSkytreeBand,
      );
      deck350.position.y = 350;
      const midShaft = new THREE.Mesh(
        new THREE.CylinderGeometry(10.5, 15, 95, 12),
        landmarkSteelWhite,
      );
      midShaft.position.y = 408;
      const deck450 = new THREE.Mesh(
        new THREE.CylinderGeometry(17, 15, 16, 16),
        landmarkSkytreeBand,
      );
      deck450.position.y = 450;
      const spire = new THREE.Mesh(
        new THREE.CylinderGeometry(1.1, 6.2, 176, 10),
        landmarkSteelWhite,
      );
      spire.position.y = 546;
      const skyBeacon = new THREE.Mesh(new THREE.SphereGeometry(3.2, 10, 10), beaconRedMat);
      skyBeacon.position.y = 635;
      lmGroup.add(lowerShaft, deck350, midShaft, deck450, spire, skyBeacon);
    } else if (lm.style === "rainbow_bridge") {
      // レインボーブリッジ：2基の126m白色H型主塔＋吊りケーブル（道路空間は完全に開通）
      for (const tx of [-280, 280]) {
        for (const tz of [-17.5, 17.5]) {
          const pylon = new THREE.Mesh(new THREE.BoxGeometry(9, 126, 8), landmarkSteelWhite);
          pylon.position.set(tx, 63, tz);
          lmGroup.add(pylon);
        }
        const crossUpper = new THREE.Mesh(new THREE.BoxGeometry(8, 7, 42), landmarkSteelWhite);
        crossUpper.position.set(tx, 118, 0);
        const crossMid = new THREE.Mesh(new THREE.BoxGeometry(7, 6, 42), landmarkBridgeGlow);
        crossMid.position.set(tx, 58, 0);
        lmGroup.add(crossUpper, crossMid);
      }
      // 主懸垂ケーブル（放物線セグメント、両側）
      for (const tz of [-17.5, 17.5]) {
        const segCount = 16;
        for (let s = 0; s < segCount; s++) {
          const t0 = s / segCount;
          const t1 = (s + 1) / segCount;
          const x0 = -280 + 560 * t0;
          const x1 = -280 + 560 * t1;
          const y0 = 26 + 96 * Math.pow(2 * t0 - 1, 2);
          const y1 = 26 + 96 * Math.pow(2 * t1 - 1, 2);
          const len = Math.hypot(x1 - x0, y1 - y0);
          const cable = new THREE.Mesh(
            new THREE.CylinderGeometry(0.65, 0.65, len, 6),
            landmarkBridgeGlow,
          );
          cable.position.set((x0 + x1) * 0.5, (y0 + y1) * 0.5, tz);
          cable.rotation.z = Math.atan2(y1 - y0, x1 - x0) - Math.PI * 0.5;
          lmGroup.add(cable);
        }
      }
    } else if (lm.style === "carrot_tower") {
      const shaft = new THREE.Mesh(new THREE.BoxGeometry(54, 124, 48), landmarkCarrotMat);
      shaft.position.y = 62;
      const crown = new THREE.Mesh(new THREE.BoxGeometry(58, 6, 52), sharedRoofCapMat);
      crown.position.y = 124;
      lmGroup.add(shaft, crown);
    } else if (lm.style === "tokyo_dome") {
      const wall = new THREE.Mesh(new THREE.CylinderGeometry(96, 102, 24, 24), sharedCommMat);
      wall.position.y = 12;
      const dome = new THREE.Mesh(
        new THREE.SphereGeometry(98, 24, 12, 0, Math.PI * 2, 0, Math.PI * 0.42),
        landmarkDomeMat,
      );
      dome.scale.set(1, 0.36, 1);
      dome.position.y = 22;
      lmGroup.add(wall, dome);
    } else if (lm.style === "fuji_tv") {
      const leftLeg = new THREE.Mesh(new THREE.BoxGeometry(44, 123, 56), sharedGlassMat);
      leftLeg.position.set(-48, 61.5, 0);
      const rightLeg = new THREE.Mesh(new THREE.BoxGeometry(44, 123, 56), sharedGlassMat);
      rightLeg.position.set(48, 61.5, 0);
      const bridgeTop = new THREE.Mesh(new THREE.BoxGeometry(142, 16, 44), landmarkSteelWhite);
      bridgeTop.position.set(0, 108, 0);
      const sphere = new THREE.Mesh(new THREE.SphereGeometry(19, 18, 14), landmarkSteelWhite);
      sphere.position.set(0, 88, 12);
      lmGroup.add(leftLeg, rightLeg, bridgeTop, sphere);
    }

    landmarksGroup.add(lmGroup);

    // レインボーブリッジ以外のランドマークに常設の物理当たり判定を設定（橋は路面開通・主塔のみ保護）
    if (lm.style !== "rainbow_bridge") {
      const colDesc = rapier.ColliderDesc.cuboid(lm.width * 0.46, lm.height * 0.5, lm.depth * 0.46)
        .setTranslation(lm.x, lm.height * 0.5, lm.z)
        .setFriction(0.6)
        .setRestitution(0.08);
      const col = world.createCollider(colDesc, staticBody);
      registerObstacleCollider(col);
    } else {
      for (const tx of [-280, 280]) {
        for (const tz of [-17.5, 17.5]) {
          const pylonCol = rapier.ColliderDesc.cuboid(4.5, 63, 4.0)
            .setTranslation(lm.x + tx, 63, lm.z + tz)
            .setFriction(0.6);
          registerObstacleCollider(world.createCollider(pylonCol, staticBody));
        }
      }
    }
  }

  rootGroup.add(waterGroup, roadNetworkGroup, landmarksGroup);

  // 外周チャンクのオンデマンド物理コライダー展開・解放（メモリ・物理負荷を一定に保持）
  const activateOuterChunkColliders = (chunkId: WorldChunkId): RAPIER.Collider[] => {
    if (activeOuterChunkColliders.has(chunkId)) {
      return [];
    }
    const specs = outerChunkBuildingSpecs.get(chunkId);
    if (!specs || specs.length === 0) {
      return [];
    }
    const created: RAPIER.Collider[] = [];
    for (let i = 0; i < specs.length; i++) {
      const b = specs[i];
      const gy = b.x < -395 ? sampleTerrainY(b.x, b.z) : 0;
      const colDesc = rapier.ColliderDesc.cuboid(b.w * 0.5, b.h * 0.5, b.d * 0.5)
        .setTranslation(b.x, gy + b.h * 0.5, b.z)
        .setFriction(0.65)
        .setRestitution(0.08);
      created.push(world.createCollider(colDesc, staticBody));
    }
    activeOuterChunkColliders.set(chunkId, created);
    return created;
  };

  const deactivateOuterChunkColliders = (chunkId: WorldChunkId): RAPIER.Collider[] => {
    const existing = activeOuterChunkColliders.get(chunkId);
    if (!existing || existing.length === 0) {
      return [];
    }
    for (let i = 0; i < existing.length; i++) {
      try {
        world.removeCollider(existing[i], false);
      } catch {
        // 既に解放済みのコライダーは無視
      }
    }
    activeOuterChunkColliders.delete(chunkId);
    return existing;
  };

  return {
    rootGroup,
    roadNetworkGroup,
    landmarksGroup,
    waterGroup,
    outerChunkGroups,
    emissiveEntries,
    totalRoadLengthKm: Number((totalRoadLengthM / 1000).toFixed(1)),
    totalOuterBuildingCount,
    activateOuterChunkColliders,
    deactivateOuterChunkColliders,
  };
}
