-- Crear el bucket si no existe
insert into storage.buckets (id, name, public)
values ('voice-bot-audio', 'voice-bot-audio', true)
on conflict (id) do nothing;

-- Crear políticas para permitir todo el acceso (lectura/escritura/borrado) de forma pública/anónima 
-- ya que esto es temporal y se autogestiona desde el backend

create policy "Audio public read"
on storage.objects for select
to public
using ( bucket_id = 'voice-bot-audio' );

create policy "Audio public insert"
on storage.objects for insert
to public
with check ( bucket_id = 'voice-bot-audio' );

create policy "Audio public update"
on storage.objects for update
to public
using ( bucket_id = 'voice-bot-audio' );

create policy "Audio public delete"
on storage.objects for delete
to public
using ( bucket_id = 'voice-bot-audio' );
