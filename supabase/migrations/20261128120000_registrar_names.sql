-- College and major labels after the registrar check (Amr, 28 Nov 2026), against the
-- university site. Codes do not change: ENG-NES keeps its code. Only labels change, so
-- students who already picked these keep their rows. Staging got these values by hand
-- first, so applying this there changes nothing.
update public.colleges set name_ar = 'كلية الأعمال' where code = 'BUS';
update public.colleges set name_ar = 'كلية الهندسة', name_en = 'College of Engineering' where code = 'ENG';
update public.majors set name_ar = 'المالية' where code = 'BUS-FIN';
update public.majors set name_ar = 'هندسة شبكات الحاسب', name_en = 'Computer Network Engineering' where code = 'ENG-NES';
