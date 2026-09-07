export interface ChatUserTurnCompositionsTable {
  session_key: string;
  idempotency_key: string;
  run_id: string | null;
  engine_type: 'openclaw' | 'claude' | 'pi';
  status: 'pending' | 'accepted' | 'rejected';
  protocol_version: number;
  display_text: string;
  source_text: string;
  message_fingerprint: string;
  provider_message_id: string | null;
  composition_json: string;
  attachments_json: string;
  host_metadata_json: string;
  error: string | null;
  created_at: string;
  updated_at: string;
}
