import {
  Baby,
  Banknote,
  Bike,
  Briefcase,
  Coffee,
  Gift,
  HandHeart,
  HeartPulse,
  Home,
  Info,
  MessageCircle,
  Package,
  PartyPopper,
  Phone,
  Plane,
  Video,
  type LucideIcon,
} from "lucide-react";

// One icon per kind of conversation, fact category and exchange (the vocabularies in backend/core/types.ts).
export const KIND_ICON: Record<string, LucideIcon> = { in_person: Coffee, call: Phone, message: MessageCircle, video: Video, event: PartyPopper };

export const CATEGORY_ICON: Record<string, LucideIcon> = {
  work: Briefcase,
  home: Home,
  family: Baby,
  health: HeartPulse,
  hobby: Bike,
  travel: Plane,
  other: Info,
};

export const EXCHANGE_ICON: Record<string, LucideIcon> = { gift_idea: Gift, gift: Gift, money: Banknote, lent: Package, help: HandHeart };
