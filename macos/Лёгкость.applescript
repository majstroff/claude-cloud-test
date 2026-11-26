-- «Лёгкость ОС»: запускает локальный сервер, открывает окно приложения
-- и останавливает сервер, когда окно закрыто или программа завершена.

on launcherPath()
	return quoted form of (POSIX path of (path to resource "launcher.sh"))
end launcherPath

on run
	try
		do shell script launcherPath() & " start"
	on error errMsg
		display alert "Не удалось запустить «Лёгкость»" message errMsg as critical
		quit
		return
	end try
	do shell script launcherPath() & " open"
end run

on reopen
	try
		do shell script launcherPath() & " open"
	end try
end reopen

on idle
	try
		set state to do shell script launcherPath() & " window"
		if state is "closed" then quit
	end try
	return 3
end idle

on quit
	try
		do shell script launcherPath() & " stop"
	end try
	continue quit
end quit
