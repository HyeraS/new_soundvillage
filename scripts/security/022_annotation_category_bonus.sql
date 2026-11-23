-- Apply after 021 in Supabase SQL Editor, before deploying the bonus UI.
-- New completed annotations: selected categories = 50 total; others = 5.
-- Votes remain 2. No retroactive credits; skips/retries retain existing guards.
begin;

create or replace function private.annotation_reward_amount_v1(p_sub_category text)
returns integer language sql immutable set search_path = '' as $$
  select case when lower(btrim(p_sub_category)) = any(array[
    'bus',
    'truck',
    'tick',
    'toilet flush',
    'hi-hat',
    'sink (filling or washing)',
    'hiss',
    'cowbell',
    'squeak',
    'typing',
    'raindrop',
    'chime',
    'fireworks',
    'insect',
    'motor vehicle (road)',
    'run',
    'footstep',
    'rain',
    'applause',
    'waves and surf'
  ]::text[]) then 50 else 5 end;
$$;
revoke all on function private.annotation_reward_amount_v1(text) from public,anon,authenticated;

create or replace function private.credit_activity_village_economy_v1(
  p_participant_id text,p_activity_type text,p_result_id uuid,p_idempotency_key uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_village text; v_amount integer; v_after bigint; v_operation uuid:=gen_random_uuid();
  v_existing public.village_currency_ledger%rowtype;
begin
  if p_result_id is null or p_idempotency_key is null then raise exception 'INVALID_REWARD_SOURCE'; end if;
  if p_activity_type='annotation' then
    select a.zone, private.annotation_reward_amount_v1(c.sub_category)
      into v_village, v_amount
      from public.annotations a
      join public.study_sound_catalog c on c.sound_id=a.sound_id
      where a.id=p_result_id and a.participant_id=p_participant_id and not a.is_skipped;
  elsif p_activity_type='vote' then
    select zone into v_village from public.votes
      where id=p_result_id and participant_id=p_participant_id;
    v_amount:=2;
  else raise exception 'INVALID_REWARD_SOURCE'; end if;
  if v_village is null or v_village not in ('Animal','Human','Nature','Urban','Music','Lab') then
    raise exception 'INVALID_REWARD_VILLAGE';
  end if;
  perform private.ensure_multi_village_wallets(p_participant_id);
  perform 1 from public.participant_village_wallets
    where participant_id=p_participant_id and village=v_village for update;
  select * into v_existing from public.village_currency_ledger
    where participant_id=p_participant_id and entry_type='earn_'||p_activity_type
      and related_id=p_result_id::text and village=v_village;
  if found then return jsonb_build_object('awarded',0,'village',v_village,
    'balance',v_existing.balance_after,'balances',private.multi_village_balances(p_participant_id)); end if;
  update public.participant_village_wallets set balance=balance+v_amount,updated_at=now()
    where participant_id=p_participant_id and village=v_village returning balance into v_after;
  insert into public.village_currency_ledger(
    participant_id,village,amount,balance_after,entry_type,related_id,operation_id,idempotency_key
  ) values(p_participant_id,v_village,v_amount,v_after,'earn_'||p_activity_type,p_result_id::text,v_operation,p_idempotency_key);
  return jsonb_build_object('awarded',v_amount,'village',v_village,'balance',v_after,
    'ledgerOperationId',v_operation,'balances',private.multi_village_balances(p_participant_id));
end $$;

create or replace function public.submit_annotation_v4(
  p_idempotency_key uuid,p_sound_id text,p_zone text,p_expression_text text default '',
  p_selected_features jsonb default null,p_confidence integer default null,p_difficulty integer default null,
  p_play_count integer default 0,p_listening_time_sec numeric default 0,p_is_skipped boolean default false,
  p_skip_reason text default '',p_device_info text default '',p_stage integer default 1,p_version text default 'v0.4-web'
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_participant public.study_participants%rowtype; v_catalog public.study_sound_catalog%rowtype;
  v_session public.study_sessions%rowtype; v_type text; v_existing jsonb; v_annotation_id public.annotations.id%type;
  v_inserted boolean:=false; v_reward jsonb; v_quests jsonb; v_progress jsonb; v_result jsonb; v_category_count integer;
begin
  v_participant:=private.require_current_participant();
  v_type:=case when p_is_skipped then 'annotation_skip' else 'annotation_submit' end;
  insert into public.idempotent_operations(auth_user_id,operation_type,idempotency_key,participant_id)
    values(auth.uid(),v_type,p_idempotency_key,v_participant.participant_id) on conflict do nothing;
  if not found then
    select result into v_existing from public.idempotent_operations where auth_user_id=auth.uid()
      and operation_type=v_type and idempotency_key=p_idempotency_key;
    if v_existing is null then raise exception 'DUPLICATE_OPERATION'; end if;
    return v_existing;
  end if;
  select * into v_catalog from public.study_sound_catalog where sound_id=p_sound_id;
  if not found or v_catalog.zone<>p_zone or not (v_catalog.group_id is null or v_catalog.group_id=v_participant.group_id or v_participant.access_scope='all')
    then raise exception 'INVALID_SOUND'; end if;
  if p_stage<>1 or p_selected_features is not null or p_difficulty is not null then raise exception 'INVALID_ANNOTATION'; end if;
  if not p_is_skipped and nullif(btrim(p_expression_text),'') is null then raise exception 'INVALID_ANNOTATION'; end if;
  select * into v_session from public.study_sessions where participant_id=v_participant.participant_id
    and experiment_round=v_participant.experiment_round and status in ('active','completed')
    order by case status when 'active' then 0 else 1 end,started_at desc limit 1 for update;
  if not found then raise exception 'STUDY_SESSION_REQUIRED'; end if;

  if v_session.status='completed' then
    if p_is_skipped then raise exception 'EXPERIMENT_COMPLETED'; end if;
    select id into v_annotation_id from public.annotations where participant_id=v_participant.participant_id
      and experiment_round=v_participant.experiment_round and canonical_audio_id=v_catalog.canonical_audio_id and not is_skipped;
    if v_annotation_id is null then raise exception 'EXPERIMENT_COMPLETED'; end if;
  else
    insert into public.annotations(participant_id,session_id,experiment_round,canonical_audio_id,sound_id,zone,source_type,sub_category,audioset_class,
      expression_text,selected_features,confidence,difficulty,play_count,listening_time_sec,is_skipped,skip_reason,device_info,stage,is_verified,vote_count,version)
    values(v_participant.participant_id,v_participant.group_id,v_participant.experiment_round,v_catalog.canonical_audio_id,p_sound_id,v_catalog.zone,
      v_catalog.source_type,v_catalog.sub_category,v_catalog.audioset_class,case when p_is_skipped then '' else btrim(p_expression_text) end,
      null,p_confidence,null,p_play_count,p_listening_time_sec,p_is_skipped,p_skip_reason,p_device_info,1,false,0,p_version)
    on conflict(participant_id,experiment_round,canonical_audio_id) where not is_skipped do nothing returning id into v_annotation_id;
    v_inserted:=v_annotation_id is not null;
    if not v_inserted and not p_is_skipped then
      select id into v_annotation_id from public.annotations where participant_id=v_participant.participant_id
        and experiment_round=v_participant.experiment_round and canonical_audio_id=v_catalog.canonical_audio_id and not is_skipped;
    end if;
  end if;
  if v_annotation_id is null then raise exception 'ANNOTATION_CONFLICT'; end if;

  if p_is_skipped or not v_inserted then
    v_reward:=jsonb_build_object('awarded',0); v_quests:=jsonb_build_object('completed','[]'::jsonb);
  else
    select count(distinct canonical_audio_id) into v_category_count from public.annotations
      where participant_id=v_participant.participant_id and sub_category=v_catalog.sub_category and not is_skipped;
    v_reward:=private.credit_currency_v3(v_participant.participant_id,'earn_annotation',private.annotation_reward_amount_v1(v_catalog.sub_category),v_catalog.canonical_audio_id,
      p_idempotency_key,p_listening_time_sec,v_catalog.sub_category,v_category_count,p_confidence);
    v_quests:=private.refresh_today_quests_v4(v_participant.participant_id,v_catalog.zone,v_catalog.sub_category,p_idempotency_key);
  end if;
  v_progress:=private.experiment_progress_v1(v_participant);
  if coalesce((v_progress->>'isComplete')::boolean,false) and v_session.status='active' then
    update public.study_sessions set status='completed',completed_at=now(),last_activity_at=now(),
      completion_reason='all_assigned_annotations_completed',completion_operation_key=p_idempotency_key,
      completion_annotation_id=v_annotation_id where id=v_session.id;
  end if;
  v_result:=jsonb_build_object('annotationId',v_annotation_id,'canonicalAudioId',v_catalog.canonical_audio_id,
    'reward',v_reward,'quests',v_quests,'skipped',p_is_skipped,'alreadyCompleted',not v_inserted,'progress',v_progress);
  update public.idempotent_operations set status='completed',result=v_result,completed_at=now()
    where auth_user_id=auth.uid() and operation_type=v_type and idempotency_key=p_idempotency_key;
  return v_result;
end $$;

-- CREATE OR REPLACE preserves existing grants. Keep the helper server-only.
revoke all on function private.credit_activity_village_economy_v1(text,text,uuid,uuid) from public,anon,authenticated;
commit;
