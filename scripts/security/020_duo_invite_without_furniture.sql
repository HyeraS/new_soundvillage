-- Apply after 019. Only the furniture gate is disabled; identity/mode checks remain.
-- Original saved-room/ownership requirement retained below for reference.
-- create or replace function private.duo_v2_host_room_eligible(
--   p_auth_user_id uuid,p_room_system text
-- ) returns boolean language plpgsql stable security definer set search_path='' as $$
-- declare
--   v_participant_id text;
--   v_room jsonb;
--   v_official_movable_ids constant text[] := array[
--     'plant_tall','plant_bush','books','fruitbowl','rug_persian_red','rug_persian_green','rug_circle_teal',
--     'curtain_red','curtain_green','bed_cream','bed_teal','dresser','wardrobe_teal','wardrobe_purple',
--     'fireplace','sofa_cream','sofa_red','armchair_cream','chair_cream','table_round','stool_wood',
--     'pot_cactus','lamp_floor','candle','xmas_tree','curtain_blue','frame_butterfly2','cat','hamster','deer','cactus'
--   ]::text[];
--   v_count integer;
-- begin
--   if p_room_system not in ('legacy','economy_v1') then return false; end if;
--   select participant_id into v_participant_id from public.study_participants
--     where auth_user_id=p_auth_user_id and status='active';
--   if v_participant_id is null then return false; end if;
--
--   if p_room_system='economy_v1' then
--     select room into v_room from public.participant_economy_v1_rooms
--       where participant_id=v_participant_id;
--     if jsonb_typeof(v_room->'items')<>'array' then return false; end if;
--     select count(distinct placement->>'itemId') into v_count
--       from jsonb_array_elements(v_room->'items') placement
--       join public.participant_catalog_items owned
--         on owned.participant_id=v_participant_id and owned.item_id=placement->>'itemId'
--       where placement->>'itemId'=any(v_official_movable_ids);
--   else
--     select room into v_room from public.participant_room where participant_id=v_participant_id;
--     if jsonb_typeof(v_room->'items')<>'array' then return false; end if;
--     select count(distinct placement->>'itemId') into v_count
--       from jsonb_array_elements(v_room->'items') placement
--       join public.participant_interior_items owned
--         on owned.participant_id=v_participant_id and owned.item_id=placement->>'itemId'
--       where placement->>'itemId'=any(v_official_movable_ids);
--   end if;
--   return coalesce(v_count,0)>=4;
-- end $$;

begin;
create or replace function private.duo_v2_host_room_eligible(
  p_auth_user_id uuid,p_room_system text
) returns boolean language sql stable security definer set search_path='' as $$
  select coalesce(p_room_system in ('legacy','economy_v1'),false)
    and private.duo_v2_participant_active(p_auth_user_id)
$$;
revoke all on function private.duo_v2_host_room_eligible(uuid,text) from public,anon,authenticated;
commit;
