import type { BrowserWindow } from 'electron';
import type { GatewayManager } from '../gateway/manager';
import type { ClawHubService } from '../gateway/clawhub';
import type { StoSkillService } from '../services/sto-skill-service';
import type { SkillPlazaService } from '../services/skill-plaza-service';
import type { HostEventBus } from './event-bus';

export interface HostApiContext {
  gatewayManager: GatewayManager;
  clawHubService: ClawHubService;
  stoSkillService: StoSkillService;
  skillPlazaService: SkillPlazaService;
  eventBus: HostEventBus;
  mainWindow: BrowserWindow | null;
}
