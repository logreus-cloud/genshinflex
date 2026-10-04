-- Титул «Модератор» выдаёт и роль moderator, отзыв титула снимает роль.
-- Титул только оформляет профиль, а права форума проверяются по public.roles.
-- Титул admin с ролью не связан: права администратора выдаются вручную.
create function public.sync_moderator_role()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' and new.title_id = 'moderator' then
    insert into public.roles (user_id, role)
    values (new.user_id, 'moderator')
    on conflict do nothing;
  elsif tg_op = 'DELETE' and old.title_id = 'moderator' then
    delete from public.roles
    where user_id = old.user_id and role = 'moderator';
  end if;
  return null;
end;
$$;

revoke all on function public.sync_moderator_role() from public, anon, authenticated;

create trigger user_titles_moderator_role
after insert or delete on public.user_titles
for each row execute function public.sync_moderator_role();

insert into public.roles (user_id, role)
select user_id, 'moderator' from public.user_titles where title_id = 'moderator'
on conflict do nothing;
