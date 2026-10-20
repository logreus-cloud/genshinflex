!include nsDialogs.nsh
!include LogicLib.nsh

Var GfLaunchWithGame
Var GfLaunchCheck

!define MUI_PAGE_CUSTOMFUNCTION_SHOW GfWelcomeShow
!define MUI_PAGE_CUSTOMFUNCTION_LEAVE GfWelcomeLeave

Function GfWelcomeShow
  ${If} $LANGUAGE == 1049
    StrCpy $0 "Запускать при входе в игру"
  ${ElseIf} $LANGUAGE == 1034
  ${OrIf} $LANGUAGE == 3082
    StrCpy $0 "Iniciar al entrar al juego"
  ${Else}
    StrCpy $0 "Launch when the game starts"
  ${EndIf}
  ${NSD_CreateCheckbox} 120u 150u 195u 12u "$0"
  Pop $GfLaunchCheck
  SetCtlColors $GfLaunchCheck "" 0xFFFFFF
  ; Текст приветствия растянут до низа страницы и перекрывает чекбокс — поднимаем его наверх
  System::Call "user32::SetWindowPos(p $GfLaunchCheck, p 0, i 0, i 0, i 0, i 0, i 3)"

  ${If} $GfLaunchWithGame == "1"
    SendMessage $GfLaunchCheck ${BM_SETCHECK} ${BST_CHECKED} 0
  ${ElseIf} $GfLaunchWithGame == "0"
    SendMessage $GfLaunchCheck ${BM_SETCHECK} ${BST_UNCHECKED} 0
  ${Else}
    ClearErrors
    ReadRegStr $0 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\GenshinFlex Overlay" "DisplayName"
    ${If} ${Errors}
      SendMessage $GfLaunchCheck ${BM_SETCHECK} ${BST_CHECKED} 0
    ${Else}
      ClearErrors
      ReadRegStr $0 HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "GenshinFlex Overlay"
      ${IfNot} ${Errors}
        SendMessage $GfLaunchCheck ${BM_SETCHECK} ${BST_CHECKED} 0
      ${EndIf}
    ${EndIf}
  ${EndIf}
FunctionEnd

Function GfWelcomeLeave
  ${If} $GfLaunchCheck != ""
    ${NSD_GetState} $GfLaunchCheck $GfLaunchWithGame
  ${EndIf}
FunctionEnd

!macro NSIS_HOOK_POSTINSTALL
  ${If} $GfLaunchWithGame == "1"
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "GenshinFlex Overlay" '"$INSTDIR\genshinflex-overlay.exe"'
    StrCpy $0 0
    gf_approved_loop:
      ClearErrors
      EnumRegValue $1 HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" $0
      ${If} ${Errors}
        Goto gf_approved_done
      ${EndIf}
      ${If} $1 == "GenshinFlex Overlay"
        WriteRegBin HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "GenshinFlex Overlay" 020000000000000000000000
        Goto gf_approved_done
      ${EndIf}
      IntOp $0 $0 + 1
      Goto gf_approved_loop
    gf_approved_done:
  ${ElseIf} $GfLaunchWithGame == "0"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "GenshinFlex Overlay"
  ${EndIf}
!macroend
